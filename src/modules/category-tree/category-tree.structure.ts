import { treeError } from './category-tree.errors.js';
import {
  getCategoryDetail,
  listAdminChildren,
  type AdminTreeNode,
  type CategoryDetail,
} from './category-tree.reads.js';
import {
  checkMoveLimits,
  childDepth,
  childPath,
  countLabel,
  wouldCreateCycle,
} from './category-tree.rules.js';
import {
  assertCodeFree,
  audit,
  lockOne,
  lockRows,
  lockSubtree,
  nextDisplayOrder,
  rebuildSubtree,
  snapshot,
  write,
  type Actor,
} from './category-tree.tx.js';
import type { MoveInput, ReorderInput } from './category-tree.dto.js';

/**
 * Structural category-tree writes (ADR-0005): reorder siblings, move a subtree and the
 * guarded delete (invariant 7). Same transaction rules as category-tree.service.ts.
 */

// ── Reorder siblings ─────────────────────────────────────────────────────────

/** Sets display_order for every child of one parent. The parent never changes. */
export async function reorderSiblings(input: ReorderInput, actor: Actor): Promise<AdminTreeNode[]> {
  await write('category.reorder', input.parentId, async (tx) => {
    if (input.parentId)
      await lockOne(tx, input.parentId).catch(() => {
        throw treeError('PARENT_NOT_FOUND');
      });
    const siblings = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM categories WHERE parent_id IS NOT DISTINCT FROM ${input.parentId}::uuid ORDER BY id FOR UPDATE`;
    const current = new Set(siblings.map((s) => s.id));
    if (
      current.size !== input.orderedIds.length ||
      !input.orderedIds.every((id) => current.has(id))
    ) {
      throw treeError('STALE_SIBLINGS');
    }
    await tx.$executeRaw`
      UPDATE categories c SET display_order = o.ord, updated_at = now()
      FROM unnest(${input.orderedIds}::uuid[]) WITH ORDINALITY AS o(id, ord)
      WHERE c.id = o.id AND c.display_order <> o.ord`;
  });
  await audit(actor, 'category.reorder', input.parentId ?? 'roots', null, {
    orderedIds: input.orderedIds,
  });
  return listAdminChildren(input.parentId);
}

// ── Move ─────────────────────────────────────────────────────────────────────

/** Moves a node under a new parent (null = make it a root) and rebuilds its subtree's paths. */
export async function moveCategory(
  id: string,
  input: MoveInput,
  actor: Actor
): Promise<CategoryDetail> {
  if (input.parentId === id) throw treeError('CYCLE');
  const outcome = await write('category.move', id, async (tx) => {
    const locked = await lockRows(tx, input.parentId ? [id, input.parentId] : [id]);
    const node = locked.get(id);
    if (!node) throw treeError('CATEGORY_NOT_FOUND');
    const parent = input.parentId ? locked.get(input.parentId) : undefined;
    if (input.parentId && !parent) throw treeError('PARENT_NOT_FOUND');

    // Already there: an idempotent retry
    if (node.parent_id === input.parentId) return { before: null };
    if (node.version !== input.version)
      throw treeError(
        'STALE_VERSION',
        `Someone else changed ${node.name}. Reload to see the latest version, then try again.`
      );

    // Invariant 2, checked inside the transaction on locked rows
    if (wouldCreateCycle(node.path, parent?.path ?? null)) {
      throw treeError(
        'CYCLE',
        `${node.name} cannot move inside itself or one of its own sub-categories`
      );
    }
    if (parent?.is_bookable) {
      throw treeError(
        'PARENT_IS_BOOKABLE',
        `${parent.name} is bookable, so it cannot have sub-categories. Turn off booking on it first.`
      );
    }
    await assertCodeFree(tx, input.parentId, node.code, parent?.name ?? 'The top level', node.id);

    const newPrefix = childPath(parent?.path ?? null, node.code);
    const depthDelta = childDepth(parent?.depth ?? null) - node.depth;
    const subtree = await lockSubtree(tx, node.path);
    const limit = checkMoveLimits([node, ...subtree], node.path, newPrefix, depthDelta);
    if (limit) throw treeError(limit);

    const rows = await rebuildSubtree(tx, node, {
      newPrefix,
      depthDelta,
      parentId: input.parentId,
      displayOrder: await nextDisplayOrder(tx, input.parentId),
      code: node.code,
    });
    return { before: snapshot(node), rows };
  });

  const node = await getCategoryDetail(id);
  if (outcome.before) {
    await audit(actor, 'category.move', id, outcome.before, {
      parentId: node.parentId,
      path: node.path,
      depth: node.depth,
      rowsRebuilt: outcome.rows,
    });
  }
  return node;
}

// ── Delete (invariant 7) ─────────────────────────────────────────────────────

export async function deleteCategory(id: string, version: number, actor: Actor): Promise<void> {
  const before = await write('category.delete', id, async (tx) => {
    const node = await lockOne(tx, id);
    if (node.version !== version)
      throw treeError(
        'STALE_VERSION',
        `Someone else changed ${node.name}. Reload to see the latest version, then try again.`
      );

    const [children, curricula, students, scopedLevels, legacyNodes] = await Promise.all([
      tx.category.count({ where: { parentId: id } }),
      tx.curriculum.count({ where: { categoryId: id } }),
      tx.studentProfile.count({ where: { categoryId: id } }),
      tx.level.count({ where: { categoryId: id } }),
      tx.catalogueNode.count({ where: { categoryId: id } }),
    ]);
    const reasons = [
      children && countLabel(children, 'sub-category', 'sub-categories'),
      curricula && countLabel(curricula, 'curriculum', 'curricula'),
      students && countLabel(students, 'student profile', 'student profiles'),
      scopedLevels && countLabel(scopedLevels, 'level scoped to it', 'levels scoped to it'),
      legacyNodes && 'a link from the previous catalogue tree',
    ].filter((r): r is string => Boolean(r));
    if (reasons.length) {
      throw treeError(
        'DELETE_BLOCKED',
        `${node.name} cannot be deleted because it has ${reasons.join(', ')}. Deactivate it instead.`,
        {
          children,
          curricula,
          students,
          scopedLevels,
          legacyNodes,
        }
      );
    }
    await tx.category.delete({ where: { id } });
    return snapshot(node);
  });
  await audit(actor, 'category.delete', id, before, null);
}
