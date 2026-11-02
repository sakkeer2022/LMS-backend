import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { appCache } from '@infrastructure/cache/index';
import { logger } from '@core/logger/index';
import { treeError } from './category-tree.errors.js';
import { ancestorPaths, subtreeCurriculaCounts } from './category-tree.rules.js';

/**
 * Admin reads of the category tree (ADR-0005). The whole tree comes from one aggregate
 * query (child and curricula counts via GROUP BY, never per row) and is cached until
 * the next write.
 */

export type Db = Prisma.TransactionClient | typeof prisma;

export const ADMIN_TREE_CACHE_KEY = 'category-tree:admin:v1';
const ADMIN_TREE_TTL_SECONDS = 600;

export interface AdminTreeNode {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  path: string;
  depth: number;
  isBookable: boolean;
  requiresBoard: boolean;
  requiresLevel: boolean;
  isActive: boolean;
  displayOrder: number;
  version: number;
  childrenCount: number;
  /** Curricula on this node (only leaves have any) */
  curriculaCount: number;
  /** Curricula on this node and every node below it */
  subtreeCurriculaCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTree {
  nodes: AdminTreeNode[];
  stats: { categories: number; bookableLeaves: number; curricula: number };
  generatedAt: string;
}

interface TreeRow {
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
  children_count: number;
  curricula_count: number;
  created_at: Date;
  updated_at: Date;
}

/** One statement: every requested node with its child and curricula counts. */
async function selectTreeRows(db: Db, parentId?: string | null): Promise<TreeRow[]> {
  const filter =
    parentId === undefined
      ? Prisma.empty
      : parentId === null
        ? Prisma.sql`WHERE c.parent_id IS NULL`
        : Prisma.sql`WHERE c.parent_id = ${parentId}::uuid`;
  return db.$queryRaw<TreeRow[]>`
    WITH child_counts AS (
      SELECT parent_id, count(*)::int AS n FROM categories WHERE parent_id IS NOT NULL GROUP BY parent_id
    ), curricula_counts AS (
      SELECT category_id, count(*)::int AS n FROM curricula GROUP BY category_id
    )
    SELECT c.id, c.parent_id, c.code, c.name, c.path, c.depth, c.is_bookable, c.requires_board,
           c.requires_level, c.is_active, c.display_order, c.version, c.created_at, c.updated_at,
           COALESCE(ch.n, 0) AS children_count, COALESCE(cu.n, 0) AS curricula_count
    FROM categories c
    LEFT JOIN child_counts ch ON ch.parent_id = c.id
    LEFT JOIN curricula_counts cu ON cu.category_id = c.id
    ${filter}
    ORDER BY c.depth, c.display_order, c.name, c.id`;
}

function toNode(row: TreeRow, subtree: number): AdminTreeNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    code: row.code,
    name: row.name,
    path: row.path,
    depth: row.depth,
    isBookable: row.is_bookable,
    requiresBoard: row.requires_board,
    requiresLevel: row.requires_level,
    isActive: row.is_active,
    displayOrder: row.display_order,
    version: row.version,
    childrenCount: row.children_count,
    curriculaCount: row.curricula_count,
    subtreeCurriculaCount: subtree,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function loadAdminTree(db: Db = prisma): Promise<AdminTree> {
  const rows = await selectTreeRows(db);
  const totals = subtreeCurriculaCounts(
    rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      name: r.name,
      displayOrder: r.display_order,
      childrenCount: r.children_count,
      curriculaCount: r.curricula_count,
    }))
  );
  const nodes = rows.map((r) => toNode(r, totals.get(r.id) ?? r.curricula_count));
  return {
    nodes,
    stats: {
      categories: nodes.length,
      bookableLeaves: nodes.filter((n) => n.isBookable).length,
      curricula: nodes.reduce((sum, n) => sum + n.curriculaCount, 0),
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * The whole tree, from the cache when possible. Entries are keyed by a generation token
 * that every write replaces, so a slow reader that loaded the tree before a write can
 * only fill an entry nobody reads any more.
 */
export async function getAdminTree(): Promise<{ tree: AdminTree; cached: boolean }> {
  const generation = await currentGeneration();
  const key = `${ADMIN_TREE_CACHE_KEY}:${generation}`;
  const hit = await appCache.get<AdminTree>(key);
  if (hit) return { tree: hit, cached: true };
  const started = Date.now();
  const tree = await loadAdminTree();
  logger.info({ nodes: tree.nodes.length, ms: Date.now() - started }, 'Category tree loaded');
  await appCache.set(key, tree, ADMIN_TREE_TTL_SECONDS);
  return { tree, cached: false };
}

const GENERATION_KEY = `${ADMIN_TREE_CACHE_KEY}:generation`;

async function currentGeneration(): Promise<string> {
  const existing = await appCache.get<string>(GENERATION_KEY);
  if (existing) return existing;
  const fresh = randomUUID();
  await appCache.set(GENERATION_KEY, fresh, ADMIN_TREE_TTL_SECONDS * 6);
  return fresh;
}

/** Called after every committed write. */
export async function invalidateAdminTree(): Promise<void> {
  await appCache.set(GENERATION_KEY, randomUUID(), ADMIN_TREE_TTL_SECONDS * 6);
}

/** Direct children of a node (or the roots), for lazy loading a large tree. */
export async function listAdminChildren(parentId: string | null): Promise<AdminTreeNode[]> {
  if (parentId) {
    const exists = await prisma.category.count({ where: { id: parentId } });
    if (!exists) throw treeError('CATEGORY_NOT_FOUND');
  }
  const rows = await selectTreeRows(prisma, parentId);
  // Subtree totals need the whole subtree; the lazy view shows the node's own count
  return rows.map((r) => toNode(r, r.curricula_count));
}

export interface CategoryDetail extends Omit<AdminTreeNode, 'subtreeCurriculaCount'> {
  description: string | null;
  breadcrumb: { id: string; name: string; path: string }[];
  allowedLevels: { id: string; code: string; name: string; isActive: boolean }[];
  activeCurriculaCount: number;
  studentCount: number;
  descendantCount: number;
}

export async function getCategoryDetail(id: string, db: Db = prisma): Promise<CategoryDetail> {
  const node = await db.category.findUnique({
    where: { id },
    include: {
      allowedLevels: {
        include: {
          level: { select: { id: true, code: true, name: true, isActive: true, sortOrder: true } },
        },
      },
      _count: { select: { children: true, curricula: true, students: true } },
    },
  });
  if (!node) throw treeError('CATEGORY_NOT_FOUND');

  const prefixes = ancestorPaths(node.path);
  const [ancestors, activeCurricula, descendants] = await Promise.all([
    prefixes.length
      ? db.category.findMany({
          where: { path: { in: prefixes } },
          select: { id: true, name: true, path: true },
        })
      : Promise.resolve([]),
    db.curriculum.count({ where: { categoryId: id, isActive: true } }),
    db.category.count({ where: { path: { startsWith: `${node.path}/` } } }),
  ]);
  const byPath = new Map(ancestors.map((a) => [a.path, a]));

  return {
    id: node.id,
    parentId: node.parentId,
    code: node.code,
    name: node.name,
    description: node.description,
    path: node.path,
    depth: node.depth,
    isBookable: node.isBookable,
    requiresBoard: node.requiresBoard,
    requiresLevel: node.requiresLevel,
    isActive: node.isActive,
    displayOrder: node.displayOrder,
    version: node.version,
    childrenCount: node._count.children,
    curriculaCount: node._count.curricula,
    activeCurriculaCount: activeCurricula,
    studentCount: node._count.students,
    descendantCount: descendants,
    breadcrumb: prefixes.flatMap((p) => {
      const a = byPath.get(p);
      return a ? [a] : [];
    }),
    allowedLevels: node.allowedLevels
      .map((cl) => cl.level)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map(({ id: levelId, code, name, isActive }) => ({ id: levelId, code, name, isActive })),
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
  };
}
