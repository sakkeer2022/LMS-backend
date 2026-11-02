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

// ── Leaf settings (invariants 3, 4 and 5) ───────────────────────────────────

export interface LeafSettingsInput {
  isBookable: boolean;
  requiresBoard: boolean;
  requiresLevel: boolean;
  levelIds: readonly string[];
}

export interface LeafState {
  childCount: number;
  /** Curricula and student profiles that reference this category */
  referenceCount: number;
  /** Level ids used by this category's curricula */
  levelsInUse: ReadonlySet<string>;
  curriculaWithoutLevel: number;
  /** Curricula and profiles without a board */
  referencesWithoutBoard: number;
}

export type LeafSettingsError =
  | 'HAS_CHILDREN'
  | 'CATEGORY_REFERENCED'
  | 'LEVELS_REQUIRED'
  | 'LEVEL_IN_USE'
  | 'LEVEL_REQUIRED_BY_CURRICULA'
  | 'BOARD_REQUIRED_BY_CURRICULA';

export function checkLeafSettings(
  input: LeafSettingsInput,
  state: LeafState
): LeafSettingsError | null {
  // Invariant 4: only a node without children has booking settings
  if (state.childCount > 0) return 'HAS_CHILDREN';
  // Invariant 3: something still books this leaf
  if (!input.isBookable && state.referenceCount > 0) return 'CATEGORY_REFERENCED';
  // Invariant 5
  if (input.isBookable && input.requiresLevel && input.levelIds.length === 0)
    return 'LEVELS_REQUIRED';
  const keep = new Set(input.levelIds);
  for (const used of state.levelsInUse) if (!keep.has(used)) return 'LEVEL_IN_USE';
  if (input.requiresLevel && state.curriculaWithoutLevel > 0) return 'LEVEL_REQUIRED_BY_CURRICULA';
  if (input.requiresBoard && state.referencesWithoutBoard > 0) return 'BOARD_REQUIRED_BY_CURRICULA';
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

// ── Tree assembly for flat rows (admin list, tests) ─────────────────────────

export interface FlatNode {
  id: string;
  parentId: string | null;
  name: string;
  displayOrder: number;
  childrenCount: number;
  curriculaCount: number;
}

export function compareSiblings(a: FlatNode, b: FlatNode): number {
  return (
    a.displayOrder - b.displayOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
}

/** Curricula in each node's whole subtree, computed once over the flat list. */
export function subtreeCurriculaCounts(nodes: readonly FlatNode[]): Map<string, number> {
  const byParent = new Map<string | null, FlatNode[]>();
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  const totals = new Map<string, number>();
  const visit = (node: FlatNode): number => {
    let total = node.curriculaCount;
    for (const child of byParent.get(node.id) ?? []) total += visit(child);
    totals.set(node.id, total);
    return total;
  };
  for (const root of byParent.get(null) ?? []) visit(root);
  return totals;
}

/** Plain-language count, never a bare number: "1 sub-category", "12 curricula". */
export function countLabel(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? singular : plural}`;
}
