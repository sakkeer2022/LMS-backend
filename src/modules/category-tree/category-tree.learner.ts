import { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import { treeError } from './category-tree.errors.js';
import { bookableLeaf, visibleTo } from './category-tree.offerings.js';
import { ancestorPaths, descendantsLikePattern } from './category-tree.rules.js';
import type { LearnerLeavesQuery } from './category-tree.dto.js';

/**
 * Learner catalogue (ADR-0005): root → tier → leaf. Only active categories with no
 * inactive ancestor are shown, and only branches that lead to at least one bookable
 * leaf with an active offering. Every list is one indexed query; no N+1.
 */

export interface LearnerNode {
  id: string;
  code: string;
  name: string;
  path: string;
  isLeaf: boolean;
}

interface NodeRow {
  id: string;
  code: string;
  name: string;
  path: string;
  is_bookable: boolean;
}

/** Visible children of a node (or the roots) that lead to something bookable. */
export async function listLearnerChildren(parentId?: string): Promise<LearnerNode[]> {
  if (parentId) {
    const [parent] = await prisma.$queryRaw<{ visible: boolean }[]>`
      SELECT (${visibleTo('c')}) AS visible FROM categories c WHERE c.id = ${parentId}::uuid`;
    if (!parent?.visible) throw treeError('CATEGORY_NOT_FOUND');
  }
  const parentFilter = parentId
    ? Prisma.sql`c.parent_id = ${parentId}::uuid`
    : Prisma.sql`c.parent_id IS NULL`;
  const rows = await prisma.$queryRaw<NodeRow[]>`
    SELECT c.id, c.code, c.name, c.path, c.is_bookable
    FROM categories c
    WHERE ${parentFilter}
      AND ${visibleTo('c')}
      AND (
        (${bookableLeaf('c')})
        OR EXISTS (
          SELECT 1 FROM categories l
          WHERE left(l.path, length(c.path) + 1) = c.path || '/' AND ${bookableLeaf('l')}
        )
      )
    ORDER BY c.display_order, c.name, c.id`;
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    path: r.path,
    isLeaf: r.is_bookable,
  }));
}

export interface LearnerLeaf extends LearnerNode {
  breadcrumb: { id: string; name: string }[];
  requiresBoard: boolean;
  requiresLevel: boolean;
}

interface LeafRow extends NodeRow {
  requires_board: boolean;
  requires_level: boolean;
  total: bigint;
}

async function breadcrumbs(paths: string[]): Promise<Map<string, { id: string; name: string }>> {
  const wanted = [...new Set(paths.flatMap(ancestorPaths))];
  if (!wanted.length) return new Map();
  const rows = await prisma.category.findMany({
    where: { path: { in: wanted } },
    select: { id: true, name: true, path: true },
  });
  return new Map(rows.map((r) => [r.path, { id: r.id, name: r.name }]));
}

/** Paginated bookable leaves, optionally below one branch and filtered by name. */
export async function listLearnerLeaves(
  query: LearnerLeavesQuery
): Promise<PaginatedResult<LearnerLeaf>> {
  let underFilter = Prisma.empty;
  if (query.under) {
    const under = await prisma.category.findUnique({
      where: { id: query.under },
      select: { path: true },
    });
    if (!under) throw treeError('CATEGORY_NOT_FOUND');
    // Constant LIKE prefix: served by the partial index on bookable, active paths
    underFilter = Prisma.sql`AND c.path LIKE ${descendantsLikePattern(under.path)}`;
  }
  const nameFilter = query.q
    ? Prisma.sql`AND c.name ILIKE ${`%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`
    : Prisma.empty;
  const offset = (query.page - 1) * query.limit;
  const rows = await prisma.$queryRaw<LeafRow[]>`
    SELECT c.id, c.code, c.name, c.path, c.is_bookable, c.requires_board, c.requires_level,
           count(*) OVER () AS total
    FROM categories c
    WHERE ${bookableLeaf('c')} ${underFilter} ${nameFilter}
    ORDER BY c.path
    LIMIT ${query.limit} OFFSET ${offset}`;
  const crumbs = await breadcrumbs(rows.map((r) => r.path));
  const total = rows.length ? Number(rows[0].total) : 0;
  return {
    items: rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      path: r.path,
      isLeaf: true,
      requiresBoard: r.requires_board,
      requiresLevel: r.requires_level,
      breadcrumb: ancestorPaths(r.path).flatMap((p) => {
        const crumb = crumbs.get(p);
        return crumb ? [crumb] : [];
      }),
    })),
    meta: buildPaginationMeta(total, query.page, query.limit),
  };
}

export interface LearnerLeafDetail extends LearnerLeaf {
  /** Shown only when requiresBoard */
  boards: { id: string; name: string }[];
  /** Shown only when requiresLevel; from category_levels */
  levels: { id: string; name: string }[];
  /** From the leaf's active offerings, narrowed by the chosen board and level */
  subjects: { id: string; name: string }[];
}

export async function getLearnerLeaf(
  id: string,
  choice: { boardId?: string; levelId?: string }
): Promise<LearnerLeafDetail> {
  const [leaf] = await prisma.$queryRaw<Omit<LeafRow, 'total'>[]>`
    SELECT c.id, c.code, c.name, c.path, c.is_bookable, c.requires_board, c.requires_level
    FROM categories c WHERE c.id = ${id}::uuid AND ${bookableLeaf('c')}`;
  if (!leaf) throw treeError('CATEGORY_NOT_FOUND');

  const offeringWhere: Prisma.CurriculumWhereInput = {
    categoryId: id,
    isActive: true,
    subject: { isActive: true },
    OR: [{ boardId: null }, { board: { isActive: true } }],
  };
  const [crumbs, levels, boardRows, subjectRows] = await Promise.all([
    breadcrumbs([leaf.path]),
    leaf.requires_level
      ? prisma.categoryLevel.findMany({
          where: { categoryId: id, level: { isActive: true } },
          select: { level: { select: { id: true, name: true, sortOrder: true } } },
        })
      : Promise.resolve([]),
    leaf.requires_board
      ? prisma.curriculum.findMany({
          where: { ...offeringWhere, boardId: { not: null } },
          select: { board: { select: { id: true, name: true, sortOrder: true } } },
          distinct: ['boardId'],
        })
      : Promise.resolve([]),
    prisma.curriculum.findMany({
      where: {
        ...offeringWhere,
        ...(choice.boardId ? { boardId: choice.boardId } : {}),
        ...(choice.levelId ? { levelId: choice.levelId } : {}),
      },
      select: { subject: { select: { id: true, name: true, sortOrder: true } } },
      distinct: ['subjectId'],
    }),
  ]);
  const byOrder = (
    a: { sortOrder: number; name: string },
    b: { sortOrder: number; name: string }
  ): number => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const strip = ({
    id: itemId,
    name,
  }: {
    id: string;
    name: string;
  }): { id: string; name: string } => ({ id: itemId, name });

  return {
    id: leaf.id,
    code: leaf.code,
    name: leaf.name,
    path: leaf.path,
    isLeaf: true,
    requiresBoard: leaf.requires_board,
    requiresLevel: leaf.requires_level,
    breadcrumb: ancestorPaths(leaf.path).flatMap((p) => {
      const crumb = crumbs.get(p);
      return crumb ? [crumb] : [];
    }),
    boards: boardRows
      .flatMap((r) => (r.board ? [r.board] : []))
      .sort(byOrder)
      .map(strip),
    levels: levels
      .map((l) => l.level)
      .sort(byOrder)
      .map(strip),
    subjects: subjectRows
      .map((r) => r.subject)
      .sort(byOrder)
      .map(strip),
  };
}
