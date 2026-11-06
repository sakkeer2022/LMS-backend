import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { appCache } from '@infrastructure/cache/index';
import { logger } from '@core/logger/index';
import { treeError } from './category-tree.errors.js';
import { ancestorPaths } from './category-tree.rules.js';

/**
 * Admin reads of the category tree (ADR-0005). The whole tree comes from one aggregate
 * query (child and tutor counts via GROUP BY, never per row) and is cached until the
 * next write. A leaf is a category without sub-categories; tutors and learners choose
 * leaves (migration 20261105090000_category_simple_leaves).
 */

export type Db = Prisma.TransactionClient | typeof prisma;

export const ADMIN_TREE_CACHE_KEY = 'category-tree:admin:v2';
const ADMIN_TREE_TTL_SECONDS = 600;

export interface AdminTreeNode {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  path: string;
  depth: number;
  /** No sub-categories: tutors and learners choose it */
  isLeaf: boolean;
  isActive: boolean;
  displayOrder: number;
  version: number;
  childrenCount: number;
  /** Tutors teaching this leaf (0 for a category with sub-categories) */
  tutorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTree {
  nodes: AdminTreeNode[];
  stats: { categories: number; leaves: number };
  generatedAt: string;
}

interface TreeRow {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  path: string;
  depth: number;
  is_active: boolean;
  display_order: number;
  version: number;
  children_count: number;
  tutor_count: number;
  created_at: Date;
  updated_at: Date;
}

/** One statement: every requested node with its child and tutor counts. */
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
    ), tutor_counts AS (
      SELECT cu.category_id, count(DISTINCT fa.faculty_id)::int AS n
      FROM curricula cu JOIN faculty_assignments fa ON fa.curriculum_id = cu.id AND fa.is_active
      GROUP BY cu.category_id
    )
    SELECT c.id, c.parent_id, c.code, c.name, c.path, c.depth, c.is_active, c.display_order,
           c.version, c.created_at, c.updated_at,
           COALESCE(ch.n, 0) AS children_count, COALESCE(tc.n, 0) AS tutor_count
    FROM categories c
    LEFT JOIN child_counts ch ON ch.parent_id = c.id
    LEFT JOIN tutor_counts tc ON tc.category_id = c.id
    ${filter}
    ORDER BY c.depth, c.display_order, c.name, c.id`;
}

function toNode(row: TreeRow): AdminTreeNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    code: row.code,
    name: row.name,
    path: row.path,
    depth: row.depth,
    isLeaf: row.children_count === 0,
    isActive: row.is_active,
    displayOrder: row.display_order,
    version: row.version,
    childrenCount: row.children_count,
    tutorCount: row.tutor_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function loadAdminTree(db: Db = prisma): Promise<AdminTree> {
  const nodes = (await selectTreeRows(db)).map(toNode);
  return {
    nodes,
    stats: { categories: nodes.length, leaves: nodes.filter((n) => n.isLeaf).length },
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
  return (await selectTreeRows(prisma, parentId)).map(toNode);
}

export interface CategoryDetail extends AdminTreeNode {
  description: string | null;
  breadcrumb: { id: string; name: string; path: string }[];
  descendantCount: number;
}

export async function getCategoryDetail(id: string, db: Db = prisma): Promise<CategoryDetail> {
  const exists = await db.category.findUnique({
    where: { id },
    select: { path: true, description: true },
  });
  if (!exists) throw treeError('CATEGORY_NOT_FOUND');
  const prefixes = ancestorPaths(exists.path);
  const [[row], ancestors, descendants] = await Promise.all([
    db.$queryRaw<TreeRow[]>`
      SELECT c.id, c.parent_id, c.code, c.name, c.path, c.depth, c.is_active, c.display_order,
             c.version, c.created_at, c.updated_at,
             (SELECT count(*)::int FROM categories ch WHERE ch.parent_id = c.id) AS children_count,
             (SELECT count(DISTINCT fa.faculty_id)::int FROM curricula cu
                JOIN faculty_assignments fa ON fa.curriculum_id = cu.id AND fa.is_active
              WHERE cu.category_id = c.id) AS tutor_count
      FROM categories c WHERE c.id = ${id}::uuid`,
    prefixes.length
      ? db.category.findMany({
          where: { path: { in: prefixes } },
          select: { id: true, name: true, path: true },
        })
      : Promise.resolve([]),
    db.category.count({ where: { path: { startsWith: `${exists.path}/` } } }),
  ]);
  if (!row) throw treeError('CATEGORY_NOT_FOUND');
  const byPath = new Map(ancestors.map((a) => [a.path, a]));
  return {
    ...toNode(row),
    description: exists.description,
    descendantCount: descendants,
    breadcrumb: prefixes.flatMap((p) => {
      const a = byPath.get(p);
      return a ? [a] : [];
    }),
  };
}
