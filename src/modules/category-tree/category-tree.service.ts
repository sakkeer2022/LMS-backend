import { getCategoryDetail, type CategoryDetail } from './category-tree.reads.js';
import { treeError } from './category-tree.errors.js';
import {
  MAX_DEPTH,
  MAX_PATH_LENGTH,
  checkMoveLimits,
  childDepth,
  childPath,
} from './category-tree.rules.js';
import {
  assertCanHaveChildren,
  assertCodeFree,
  audit,
  lockOne,
  lockRows,
  lockSubtree,
  nextDisplayOrder,
  parentPathOf,
  rebuildSubtree,
  snapshot,
  write,
  type Actor,
  type LockedRow,
} from './category-tree.tx.js';
import type { CreateNodeInput, UpdateCategoryInput } from './category-tree.dto.js';

/**
 * Category tree node writes (ADR-0005): create and update (name, code, active). Leaves
 * are derived (a category without sub-categories); the categories_leaf_sync trigger
 * keeps their category curriculum in step. Each is one transaction: rows are locked with SELECT … FOR UPDATE, the
 * version and the rule are checked, then the change is written; the deferred triggers
 * re-check the invariants. Structural writes (reorder, move, delete) are in
 * category-tree.structure.ts.
 */

export type { Actor } from './category-tree.tx.js';
export { checkDeferredConstraints } from './category-tree.tx.js';

// ── Create ──────────────────────────────────────────────────────────────────

export interface CreateResult {
  node: CategoryDetail;
  /** false when a retry found the identical category already created (idempotent replay) */
  created: boolean;
}

/** Creates a root (parentId null) or a child. A retry with the same code and name returns the existing node. */
export async function createCategory(
  parentId: string | null,
  input: CreateNodeInput,
  actor: Actor
): Promise<CreateResult> {
  const result = await write('category.create', parentId, async (tx) => {
    let parent: LockedRow | undefined;
    if (parentId) {
      parent = (await lockRows(tx, [parentId])).get(parentId);
      if (!parent) throw treeError('PARENT_NOT_FOUND');
      await assertCanHaveChildren(tx, parent);
    } else {
      // Serialise root creation so display orders do not collide
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('category_tree:roots'))`;
    }

    const existing = await tx.category.findFirst({ where: { parentId, code: input.code } });
    if (existing) {
      if (existing.name === input.name) return { id: existing.id, created: false };
      throw treeError(
        'DUPLICATE_CODE',
        `${parent?.name ?? 'The top level'} already has a sub-category with the code "${input.code}"`
      );
    }

    const path = childPath(parent?.path ?? null, input.code);
    const depth = childDepth(parent?.depth ?? null);
    if (path.length > MAX_PATH_LENGTH) throw treeError('PATH_TOO_LONG');
    if (depth > MAX_DEPTH) throw treeError('TOO_DEEP');

    const created = await tx.category.create({
      data: {
        parentId,
        code: input.code,
        name: input.name,
        path,
        depth,
        displayOrder: await nextDisplayOrder(tx, parentId),
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  });

  const node = await getCategoryDetail(result.id);
  if (result.created) {
    await audit(actor, parentId ? 'category.create_child' : 'category.create_root', node.id, null, {
      parentId,
      code: node.code,
      name: node.name,
      path: node.path,
    });
  }
  return { node, created: result.created };
}

// ── Update: rename, change code, activate or deactivate ─────────────────────

export async function updateCategory(
  id: string,
  input: UpdateCategoryInput,
  actor: Actor
): Promise<CategoryDetail> {
  const outcome = await write('category.update', id, async (tx) => {
    const node = await lockOne(tx, id);
    const unchanged =
      (input.name === undefined || input.name === node.name) &&
      (input.code === undefined || input.code === node.code) &&
      (input.isActive === undefined || input.isActive === node.is_active);
    // A retry of a write that already succeeded finds the values it wanted: return them
    if (unchanged) return { before: null };
    if (node.version !== input.version)
      throw treeError(
        'STALE_VERSION',
        `Someone else changed ${node.name}. Reload to see the latest version, then try again.`
      );

    if (input.code !== undefined && input.code !== node.code) {
      const parentPath = parentPathOf(node);
      const parentName = node.parent_id
        ? ((await tx.category.findUnique({ where: { id: node.parent_id }, select: { name: true } }))
            ?.name ?? 'The parent')
        : 'The top level';
      await assertCodeFree(tx, node.parent_id, input.code, parentName, node.id);
      const newPrefix = childPath(parentPath, input.code);
      const subtree = await lockSubtree(tx, node.path);
      const limit = checkMoveLimits([node, ...subtree], node.path, newPrefix, 0);
      if (limit) throw treeError(limit);
      await rebuildSubtree(tx, node, {
        newPrefix,
        depthDelta: 0,
        parentId: node.parent_id,
        displayOrder: node.display_order,
        code: input.code,
      });
      if (input.name !== undefined || input.isActive !== undefined) {
        await tx.category.update({
          where: { id },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.isActive !== undefined && { isActive: input.isActive }),
          },
        });
      }
    } else {
      await tx.category.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
          version: { increment: 1 },
        },
      });
    }
    return { before: snapshot(node) };
  });

  const node = await getCategoryDetail(id);
  if (outcome.before) {
    await audit(actor, 'category.update', id, outcome.before, {
      code: node.code,
      name: node.name,
      path: node.path,
      isActive: node.isActive,
      version: node.version,
    });
  }
  return node;
}
