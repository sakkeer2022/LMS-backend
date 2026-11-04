import type { CatalogueNodeStatus, CatalogueNodeType } from '@prisma/client';

/**
 * Pure catalogue tree rules (ADR 0003). No database access, so every rule is
 * unit tested in tests/unit/catalogue-tree.test.ts.
 */

/** Node types from root to leaf; a child's type must come later than its parent's. */
export const TYPE_ORDER: readonly CatalogueNodeType[] = [
  'CATEGORY',
  'SUBSECTION',
  'BOARD',
  'SUBJECT',
  'LEVEL',
];

const rank = (type: CatalogueNodeType): number => TYPE_ORDER.indexOf(type);

export interface TreeNodeRow {
  id: string;
  parentId: string | null;
  rootId: string;
  type: CatalogueNodeType;
  name: string;
  slug: string;
  status: CatalogueNodeStatus;
  sortOrder: number;
  categoryId: string | null;
  boardId: string | null;
  subjectId: string | null;
  levelId: string | null;
  bookingEnabled: boolean;
}

export type PlacementError =
  | 'CATEGORY_NOT_ALLOWED'
  | 'INVALID_PARENT_TYPE'
  | 'BOARD_NOT_ALLOWED'
  | 'BOARD_REQUIRED'
  | 'LEVEL_PARENT_MUST_BE_SUBJECT';

/**
 * Checks whether a node of `type` may sit under `parentType`.
 * - Types follow CATEGORY > SUBSECTION > BOARD > SUBJECT > LEVEL; SUBSECTION and BOARD may be skipped.
 * - CATEGORY nodes are the four fixed tabs and are never created or moved through the API (D8).
 * - BOARD exists only in categories that require a board (School); there, subjects sit under a board.
 * - A LEVEL leaf needs a SUBJECT parent, because the leaf's curriculum needs a subject.
 */
export function checkPlacement(
  type: CatalogueNodeType,
  parentType: CatalogueNodeType,
  requiresBoard: boolean
): PlacementError | null {
  if (type === 'CATEGORY') return 'CATEGORY_NOT_ALLOWED';
  if (rank(type) <= rank(parentType)) return 'INVALID_PARENT_TYPE';
  if (type === 'BOARD' && !requiresBoard) return 'BOARD_NOT_ALLOWED';
  if (type === 'SUBJECT' && requiresBoard && parentType !== 'BOARD') return 'BOARD_REQUIRED';
  if (type === 'LEVEL' && parentType !== 'SUBJECT') return 'LEVEL_PARENT_MUST_BE_SUBJECT';
  return null;
}

export function placementMessage(error: PlacementError): string {
  switch (error) {
    case 'CATEGORY_NOT_ALLOWED':
      return 'Category nodes are fixed and cannot be created or moved';
    case 'INVALID_PARENT_TYPE':
      return 'A node must come after its parent in the order category > subsection > board > subject > level';
    case 'BOARD_NOT_ALLOWED':
      return 'Boards are allowed only in categories that require a board';
    case 'BOARD_REQUIRED':
      return 'In this category a subject must sit under a board';
    case 'LEVEL_PARENT_MUST_BE_SUBJECT':
      return 'A level must sit under a subject';
  }
}

/** Index of a category's nodes, for in-memory tree work. */
export class NodeIndex {
  readonly byId = new Map<string, TreeNodeRow>();
  readonly children = new Map<string, TreeNodeRow[]>();

  constructor(rows: readonly TreeNodeRow[]) {
    for (const row of rows) this.byId.set(row.id, row);
    for (const row of rows) {
      if (row.parentId === null) continue;
      const list = this.children.get(row.parentId) ?? [];
      list.push(row);
      this.children.set(row.parentId, list);
    }
    for (const list of this.children.values()) list.sort(compareSiblings);
  }

  childrenOf(id: string): TreeNodeRow[] {
    return this.children.get(id) ?? [];
  }

  /** Ancestors from the root down to the direct parent. */
  ancestors(id: string): TreeNodeRow[] {
    const path: TreeNodeRow[] = [];
    let current = this.byId.get(id);
    const seen = new Set<string>();
    while (current?.parentId) {
      if (seen.has(current.parentId)) break;
      seen.add(current.parentId);
      const parent = this.byId.get(current.parentId);
      if (!parent) break;
      path.unshift(parent);
      current = parent;
    }
    return path;
  }

  /** The node and every node below it. */
  subtree(id: string): TreeNodeRow[] {
    const out: TreeNodeRow[] = [];
    const stack = [id];
    for (let nextId = stack.pop(); nextId !== undefined; nextId = stack.pop()) {
      const node = this.byId.get(nextId);
      if (!node) continue;
      out.push(node);
      for (const child of this.childrenOf(node.id)) stack.push(child.id);
    }
    return out;
  }

  /** True when `candidateId` is `id` itself or lies below it. Used to block cycles on move. */
  isSelfOrDescendant(id: string, candidateId: string): boolean {
    return this.subtree(id).some((n) => n.id === candidateId);
  }

  /** Published only when the node and every ancestor are PUBLISHED. */
  isEffectivelyPublished(id: string): boolean {
    const node = this.byId.get(id);
    if (!node || node.status !== 'PUBLISHED') return false;
    return this.ancestors(id).every((a) => a.status === 'PUBLISHED');
  }

  /** The offering tuple a LEVEL leaf stands for, taken from its ancestors. */
  offeringOf(
    leafId: string
  ): { categoryId: string; boardId: string | null; subjectId: string; levelId: string } | null {
    const leaf = this.byId.get(leafId);
    if (!leaf || leaf.type !== 'LEVEL' || !leaf.levelId) return null;
    const path = this.ancestors(leafId);
    const categoryId = path.find((n) => n.type === 'CATEGORY')?.categoryId ?? null;
    const subjectId = path.find((n) => n.type === 'SUBJECT')?.subjectId ?? null;
    const boardId = path.find((n) => n.type === 'BOARD')?.boardId ?? null;
    if (!categoryId || !subjectId) return null;
    return { categoryId, boardId, subjectId, levelId: leaf.levelId };
  }
}

export function compareSiblings(a: TreeNodeRow, b: TreeNodeRow): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export interface DescendantCounts {
  subsections: number;
  boards: number;
  subjects: number;
  levels: number;
}

export interface TreeNodeView {
  id: string;
  parentId: string | null;
  type: CatalogueNodeType;
  name: string;
  slug: string;
  status: CatalogueNodeStatus;
  sortOrder: number;
  categoryId: string | null;
  boardId: string | null;
  subjectId: string | null;
  levelId: string | null;
  bookingEnabled: boolean;
  curriculumId: string | null;
  childCount: number;
  counts: DescendantCounts;
  children: TreeNodeView[];
}

export interface BuildTreeOptions {
  /** Keep only nodes that are effectively published (public tree). */
  publishedOnly?: boolean;
  /** Case-insensitive name filter; matching nodes keep their ancestors and their whole subtree. */
  q?: string;
  /** LEVEL node id -> curriculum id. */
  curriculumByNode?: ReadonlyMap<string, string>;
}

/** Builds the nested view for one category, with child and descendant counts (screen 28). */
export function buildTree(
  index: NodeIndex,
  rootId: string,
  options: BuildTreeOptions = {}
): TreeNodeView | null {
  const root = index.byId.get(rootId);
  if (!root) return null;
  const include = visibleIds(index, rootId, options);
  if (!include.has(rootId)) return null;

  const build = (node: TreeNodeRow): TreeNodeView => {
    const children = index
      .childrenOf(node.id)
      .filter((c) => include.has(c.id))
      .map(build);
    const counts: DescendantCounts = { subsections: 0, boards: 0, subjects: 0, levels: 0 };
    for (const child of children) {
      counts.subsections += child.counts.subsections + (child.type === 'SUBSECTION' ? 1 : 0);
      counts.boards += child.counts.boards + (child.type === 'BOARD' ? 1 : 0);
      counts.subjects += child.counts.subjects + (child.type === 'SUBJECT' ? 1 : 0);
      counts.levels += child.counts.levels + (child.type === 'LEVEL' ? 1 : 0);
    }
    return {
      id: node.id,
      parentId: node.parentId,
      type: node.type,
      name: node.name,
      slug: node.slug,
      status: node.status,
      sortOrder: node.sortOrder,
      categoryId: node.categoryId,
      boardId: node.boardId,
      subjectId: node.subjectId,
      levelId: node.levelId,
      bookingEnabled: node.bookingEnabled,
      curriculumId: options.curriculumByNode?.get(node.id) ?? null,
      childCount: children.length,
      counts,
      children,
    };
  };
  return build(root);
}

function visibleIds(index: NodeIndex, rootId: string, options: BuildTreeOptions): Set<string> {
  let ids = index.subtree(rootId).map((n) => n.id);
  if (options.publishedOnly) ids = ids.filter((id) => index.isEffectivelyPublished(id));
  const allowed = new Set(ids);

  const q = options.q?.trim().toLowerCase();
  if (!q) return allowed;

  const result = new Set<string>();
  for (const id of allowed) {
    const node = index.byId.get(id);
    if (!node?.name.toLowerCase().includes(q)) continue;
    for (const a of index.ancestors(id)) if (allowed.has(a.id)) result.add(a.id);
    for (const d of index.subtree(id)) if (allowed.has(d.id)) result.add(d.id);
  }
  return result;
}

/** Lowercase slug matching the contract's code pattern `^[a-z][a-z0-9_-]*$`. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  if (!slug) return 'node';
  return /^[a-z]/.test(slug) ? slug : `n-${slug}`.slice(0, 64);
}
