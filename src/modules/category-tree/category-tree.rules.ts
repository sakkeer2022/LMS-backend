/**
 * Pure category-tree rules (ADR-0005). No database access, so each rule is unit tested
 * in tests/unit/category-tree-rules.test.ts. The database enforces the same invariants
 * (CHECK constraints and deferred triggers); these give users a clear message first.
 */

export const CODE_PATTERN = /^[a-z][a-z0-9_-]*$/;
export const MAX_CODE_LENGTH = 50;
export const MAX_NAME_LENGTH = 100;
export const MAX_PATH_LENGTH = 500;
// Matches categories_depth_check in the expand migration
export const MAX_DEPTH = 20;

export interface PathNode {
  id: string;
  parentId: string | null;
  code: string;
  path: string;
  depth: number;
}

/** Invariant 1: a root's path is its code; a child's path is the parent's path + '/' + code. */
export function childPath(parentPath: string | null, code: string): string {
  return parentPath === null ? code : `${parentPath}/${code}`;
}

export function childDepth(parentDepth: number | null): number {
  return parentDepth === null ? 0 : parentDepth + 1;
}

/** True when `candidate` is `node` itself or lies below it (by materialised path). */
export function isSelfOrDescendantPath(nodePath: string, candidatePath: string): boolean {
  return candidatePath === nodePath || candidatePath.startsWith(`${nodePath}/`);
}

/**
 * Invariant 2: a node may not move under itself or any of its descendants. `newParentPath`
 * null means "make it a root", which can never create a cycle.
 */
export function wouldCreateCycle(nodePath: string, newParentPath: string | null): boolean {
  return newParentPath !== null && isSelfOrDescendantPath(nodePath, newParentPath);
}

/** The new path of a subtree member after its subtree root moves from oldPrefix to newPrefix. */
export function rebasePath(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) return newPrefix;
  if (!path.startsWith(`${oldPrefix}/`)) throw new Error(`${path} is not under ${oldPrefix}`);
  return newPrefix + path.slice(oldPrefix.length);
}

/** Sibling order with `id` inserted at `index` (clamped to the list), for a move to a position. */
export function insertAt(siblingIds: readonly string[], id: string, index: number): string[] {
  const rest = siblingIds.filter((s) => s !== id);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** Escapes a path for a LIKE prefix match on the subtree below it (codes may contain "_"). */
export function descendantsLikePattern(path: string): string {
  return `${path.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;
}

/** Breadcrumb ancestors' paths for a node's path: 'a/b/c' -> ['a', 'a/b']. */
export function ancestorPaths(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** Validates every path and depth after a move, before touching the database. */
export function checkMoveLimits(
  subtree: readonly Pick<PathNode, 'path' | 'depth'>[],
  oldPrefix: string,
  newPrefix: string,
  depthDelta: number
): 'PATH_TOO_LONG' | 'TOO_DEEP' | null {
  for (const node of subtree) {
    if (rebasePath(node.path, oldPrefix, newPrefix).length > MAX_PATH_LENGTH)
      return 'PATH_TOO_LONG';
    if (node.depth + depthDelta > MAX_DEPTH) return 'TOO_DEEP';
  }
  return null;
}

// ── Offering selection (what a learner picks on a leaf) ──────────────────────

export interface LeafRules {
  isBookable: boolean;
  requiresBoard: boolean;
  requiresLevel: boolean;
  allowedLevelIds: ReadonlySet<string>;
}

export type SelectionError =
  | 'NOT_BOOKABLE'
  | 'BOARD_REQUIRED'
  | 'LEVEL_REQUIRED'
  | 'LEVEL_NOT_ALLOWED';

/** Invariants 3 and 5 for one (board?, level?) choice on a leaf. */
export function checkSelection(
  leaf: LeafRules,
  choice: { boardId?: string | null; levelId?: string | null }
): SelectionError | null {
  if (!leaf.isBookable) return 'NOT_BOOKABLE';
  if (leaf.requiresBoard && !choice.boardId) return 'BOARD_REQUIRED';
  if (leaf.requiresLevel && !choice.levelId) return 'LEVEL_REQUIRED';
  if (choice.levelId && !leaf.allowedLevelIds.has(choice.levelId)) return 'LEVEL_NOT_ALLOWED';
  return null;
}

/** Plain-language count, never a bare number: "1 sub-category", "3 tutors". */
export function countLabel(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? singular : plural}`;
}
