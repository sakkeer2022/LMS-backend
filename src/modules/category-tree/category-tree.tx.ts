import { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { getTraceId } from '@core/context/index';
import { logger } from '@core/logger/index';
import { logAction } from '@modules/audit/index';
import { toTreeError, treeError } from './category-tree.errors.js';
import { invalidateAdminTree } from './category-tree.reads.js';
import { descendantsLikePattern } from './category-tree.rules.js';

/**
 * Transaction plumbing shared by the category-tree writes (ADR-0005): row locks in a
 * fixed order, the subtree rebuild, the write wrapper that maps database errors and
 * invalidates the cache, and the audit entry.
 */

export type Tx = Prisma.TransactionClient;

export interface Actor {
  userId: string | null;
}

export interface LockedRow {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  path: string;
  depth: number;
  is_bookable: boolean;
  requires_board: boolean;
  requires_level: boolean;
  is_active: boolean;
  display_order: number;
  version: number;
}

export async function lockRows(tx: Tx, ids: string[]): Promise<Map<string, LockedRow>> {
  const unique = [...new Set(ids)];
  // Sorted ids give every transaction the same lock order
  const rows = await tx.$queryRaw<LockedRow[]>`
    SELECT id, parent_id, code, name, path, depth, is_bookable, requires_board, requires_level,
           is_active, display_order, version
    FROM categories WHERE id = ANY(${unique}::uuid[]) ORDER BY id FOR UPDATE`;
  return new Map(rows.map((r) => [r.id, r]));
}

export async function lockOne(tx: Tx, id: string): Promise<LockedRow> {
  const row = (await lockRows(tx, [id])).get(id);
  if (!row) throw treeError('CATEGORY_NOT_FOUND');
  return row;
}

/** Locks every node below `path`, so no concurrent write can change the subtree being rebuilt. */
export async function lockSubtree(
  tx: Tx,
  path: string
): Promise<{ id: string; path: string; depth: number }[]> {
  return tx.$queryRaw`
    SELECT id, path, depth FROM categories WHERE path LIKE ${descendantsLikePattern(path)}
    ORDER BY id FOR UPDATE`;
}

export function parentPathOf(row: Pick<LockedRow, 'parent_id' | 'path' | 'code'>): string | null {
  return row.parent_id === null ? null : row.path.slice(0, -(row.code.length + 1));
}

/**
 * Rewrites path and depth for a node and its whole subtree in one statement (invariant 1)
 * and bumps their versions. The deferred trigger checks the result at commit.
 */
export async function rebuildSubtree(
  tx: Tx,
  node: LockedRow,
  change: {
    newPrefix: string;
    depthDelta: number;
    parentId: string | null;
    displayOrder: number;
    code: string;
  }
): Promise<number> {
  return tx.$executeRaw`
    UPDATE categories SET
      path = ${change.newPrefix} || substr(path, ${node.path.length + 1}),
      depth = depth + ${change.depthDelta},
      parent_id = CASE WHEN id = ${node.id}::uuid THEN ${change.parentId}::uuid ELSE parent_id END,
      display_order = CASE WHEN id = ${node.id}::uuid THEN ${change.displayOrder} ELSE display_order END,
      code = CASE WHEN id = ${node.id}::uuid THEN ${change.code} ELSE code END,
      version = version + 1,
      updated_at = now()
    WHERE id = ${node.id}::uuid OR path LIKE ${descendantsLikePattern(node.path)}`;
}

export async function assertCodeFree(
  tx: Tx,
  parentId: string | null,
  code: string,
  parentName: string,
  exceptId?: string
): Promise<void> {
  const clash = await tx.category.findFirst({
    where: { parentId, code, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    throw treeError(
      'DUPLICATE_CODE',
      `${parentName} already has a sub-category with the code "${code}"`
    );
  }
}

export async function nextDisplayOrder(tx: Tx, parentId: string | null): Promise<number> {
  const last = await tx.category.aggregate({ where: { parentId }, _max: { displayOrder: true } });
  return (last._max.displayOrder ?? 0) + 1;
}

/**
 * Fires the deferred tree triggers now, inside the transaction. A trigger that fails at
 * COMMIT reaches Prisma only as a generic "transaction already closed" error, which
 * would hide the reason (for example PARENT_IS_BOOKABLE after a race).
 */
export async function checkDeferredConstraints(tx: Tx): Promise<void> {
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
}

/** Runs a write transaction, maps database errors to typed errors, then invalidates the cache. */
export async function write<T>(
  action: string,
  categoryId: string | null,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  let result: T;
  try {
    result = await prisma.$transaction(
      async (tx) => {
        const value = await fn(tx);
        await checkDeferredConstraints(tx);
        return value;
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
  } catch (err) {
    const mapped = toTreeError(err);
    if (mapped === err) logger.error({ err, action, categoryId }, 'Category tree write failed');
    else
      logger.info(
        { action, categoryId, code: (mapped as { code?: string }).code },
        'Category tree write rejected'
      );
    throw mapped;
  }
  await invalidateAdminTree();
  return result;
}

export async function audit(
  actor: Actor,
  action: string,
  resourceId: string,
  previousValue: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null
): Promise<void> {
  logger.info({ action, resourceId, actorId: actor.userId }, 'Category tree changed');
  try {
    await logAction({
      traceId: getTraceId() ?? null,
      actorId: actor.userId,
      entity: 'category',
      action,
      resourceId,
      previousValue,
      newValue,
    });
  } catch (err) {
    // The change is committed; record the failure instead of failing the request
    logger.error({ err, action, resourceId }, 'Failed to write category audit entry');
  }
}

export function snapshot(row: LockedRow): Record<string, unknown> {
  return {
    parentId: row.parent_id,
    code: row.code,
    name: row.name,
    path: row.path,
    isActive: row.is_active,
    version: row.version,
  };
}

/**
 * A leaf that tutors or learners already use cannot get sub-categories, because they
 * would lose the thing they picked (migration 20261105090000_category_simple_leaves).
 * The categories_leaf_sync trigger enforces the same rule; this gives the clear message.
 */
export async function assertCanHaveChildren(tx: Tx, parent: LockedRow): Promise<void> {
  if (!parent.is_bookable) return;
  const [row] = await tx.$queryRaw<{ in_use: boolean }[]>`
    SELECT category_in_use(${parent.id}::uuid) AS in_use`;
  if (row?.in_use) {
    throw treeError(
      'CATEGORY_IN_USE',
      `${parent.name} is already used by tutors, prices or learners, so it cannot have sub-categories. Add the sub-category somewhere else.`
    );
  }
}
