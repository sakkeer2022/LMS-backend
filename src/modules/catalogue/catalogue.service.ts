import { Prisma, type CatalogueNode } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { ConflictError, NotFoundError, ValidationError } from '@core/errors/index';
import { getTraceId } from '@core/context/index';
import { logger } from '@core/logger/index';
import { logAction } from '@modules/audit/index';
import { NodeIndex, buildTree, type TreeNodeRow, type TreeNodeView } from './catalogue.tree.js';

/**
 * Catalogue tree reads, curriculum sync and the internal API that pricing and
 * faculty use (ADR 0003). Mutations live in catalogue.mutations.ts.
 */

export type Db = Prisma.TransactionClient | typeof prisma;

export interface Actor {
  userId: string | null;
}

// ── Extension points for modules that depend on the catalogue ───────────────
// Pricing (and later faculty or library) registers here instead of the catalogue
// importing them, which would create a circular dependency.

/** Returns the ids (from the given list) of curricula the registering module uses. */
export type CurriculumUsageCheck = (db: Db, curriculumIds: string[]) => Promise<string[]>;
/** Returns the default session price in paise for a curriculum, or null. */
export type CurriculumPriceProvider = (curriculumId: string) => Promise<number | null>;

const usageChecks: CurriculumUsageCheck[] = [];
let priceProvider: CurriculumPriceProvider | null = null;

export function registerCurriculumUsageCheck(check: CurriculumUsageCheck): void {
  usageChecks.push(check);
}

export function registerCurriculumPriceProvider(provider: CurriculumPriceProvider): void {
  priceProvider = provider;
}

const nodeSelect = {
  id: true,
  parentId: true,
  rootId: true,
  type: true,
  name: true,
  slug: true,
  status: true,
  sortOrder: true,
  categoryId: true,
  boardId: true,
  subjectId: true,
  levelId: true,
  bookingEnabled: true,
} satisfies Prisma.CatalogueNodeSelect;

/** Loads every node of one category plus the leaf -> curriculum map. */
export async function loadCategory(
  db: Db,
  rootId: string
): Promise<{ index: NodeIndex; curriculumByNode: Map<string, string> }> {
  const [rows, curricula] = await Promise.all([
    db.catalogueNode.findMany({ where: { rootId }, select: nodeSelect }),
    db.curriculum.findMany({ where: { node: { rootId } }, select: { id: true, nodeId: true } }),
  ]);
  const curriculumByNode = new Map<string, string>();
  for (const c of curricula) if (c.nodeId) curriculumByNode.set(c.nodeId, c.id);
  return { index: new NodeIndex(rows as TreeNodeRow[]), curriculumByNode };
}

export interface CategoryRoot {
  root: CatalogueNode;
  requiresBoard: boolean;
  categoryActive: boolean;
}

export async function getRootForCategory(db: Db, categoryId: string): Promise<CategoryRoot> {
  const root = await db.catalogueNode.findUnique({
    where: { categoryId },
    include: { category: { select: { requiresBoard: true, isActive: true } } },
  });
  if (!root || !root.category) throw new NotFoundError('Category');
  const { category, ...node } = root;
  return { root: node, requiresBoard: category.requiresBoard, categoryActive: category.isActive };
}

export async function getTree(
  categoryId: string,
  options: { publishedOnly: boolean; q?: string }
): Promise<TreeNodeView> {
  const { root, categoryActive } = await getRootForCategory(prisma, categoryId);
  if (options.publishedOnly && !categoryActive) throw new NotFoundError('Category');
  const { index, curriculumByNode } = await loadCategory(prisma, root.id);
  const tree = buildTree(index, root.id, { ...options, curriculumByNode });
  if (tree) return tree;

  // An admin search with no match still returns the root, without children
  const bare =
    options.publishedOnly || !options.q ? null : buildTree(index, root.id, { curriculumByNode });
  if (!bare) throw new NotFoundError('Category');
  return { ...bare, children: [], childCount: 0 };
}

export interface NodeDetail {
  id: string;
  parentId: string | null;
  rootId: string;
  type: TreeNodeRow['type'];
  name: string;
  slug: string;
  status: TreeNodeRow['status'];
  sortOrder: number;
  categoryId: string | null;
  boardId: string | null;
  subjectId: string | null;
  levelId: string | null;
  bookingEnabled: boolean;
  curriculumId: string | null;
  path: { id: string; type: TreeNodeRow['type']; name: string }[];
  childCount: number;
  counts: TreeNodeView['counts'];
  // Screen 28 detail panel. Null until the owning module exists; never a made-up number.
  libraryResources: number | null;
  tutorsMapped: number | null;
  sessionsThisMonth: number | null;
  sessionPricePaise: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getNodeDetail(
  nodeId: string,
  options: { publicOnly: boolean }
): Promise<NodeDetail> {
  const node = await prisma.catalogueNode.findUnique({ where: { id: nodeId } });
  if (!node) throw new NotFoundError('Catalogue node');
  const { index, curriculumByNode } = await loadCategory(prisma, node.rootId);
  if (options.publicOnly && !index.isEffectivelyPublished(node.id))
    throw new NotFoundError('Catalogue node');

  const view = buildTree(index, node.rootId, {
    publishedOnly: options.publicOnly,
    curriculumByNode,
  });
  const sub = view ? findInView(view, node.id) : null;
  const curriculumId = curriculumByNode.get(node.id) ?? null;
  return {
    id: node.id,
    parentId: node.parentId,
    rootId: node.rootId,
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
    curriculumId,
    path: index.ancestors(node.id).map((a) => ({ id: a.id, type: a.type, name: a.name })),
    childCount: sub?.childCount ?? 0,
    counts: sub?.counts ?? { subsections: 0, boards: 0, subjects: 0, levels: 0 },
    libraryResources: null,
    tutorsMapped: null,
    sessionsThisMonth: null,
    sessionPricePaise: curriculumId && priceProvider ? await priceProvider(curriculumId) : null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

function findInView(view: TreeNodeView, id: string): TreeNodeView | null {
  if (view.id === id) return view;
  for (const child of view.children) {
    const hit = findInView(child, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Makes every LEVEL leaf of a category own a curriculum whose tuple matches its
 * ancestors, active only while the leaf and all ancestors are published.
 * A legacy curriculum with the same tuple and no owner is adopted instead of duplicated.
 */
export async function syncCurricula(tx: Prisma.TransactionClient, rootId: string): Promise<void> {
  const { index } = await loadCategory(tx, rootId);
  const owned = await tx.curriculum.findMany({ where: { node: { rootId } } });
  const byNode = new Map(owned.flatMap((c) => (c.nodeId ? [[c.nodeId, c] as const] : [])));

  for (const leaf of index.byId.values()) {
    if (leaf.type !== 'LEVEL') continue;
    const offering = index.offeringOf(leaf.id);
    if (!offering) continue;
    const isActive = index.isEffectivelyPublished(leaf.id);
    const current = byNode.get(leaf.id);

    if (!current) {
      const legacy = await tx.curriculum.findFirst({ where: { ...offering, nodeId: null } });
      if (legacy) {
        await tx.curriculum.update({
          where: { id: legacy.id },
          data: { nodeId: leaf.id, isActive },
        });
      } else {
        await tx.curriculum.create({ data: { ...offering, nodeId: leaf.id, isActive } });
      }
      continue;
    }
    const changed =
      current.categoryId !== offering.categoryId ||
      current.boardId !== offering.boardId ||
      current.subjectId !== offering.subjectId ||
      current.levelId !== offering.levelId ||
      current.isActive !== isActive;
    if (changed)
      await tx.curriculum.update({ where: { id: current.id }, data: { ...offering, isActive } });
  }
}

/** Ids of curricula (from the given list) that other modules already reference (D16). */
export async function curriculaInUse(db: Db, curriculumIds: string[]): Promise<string[]> {
  if (curriculumIds.length === 0) return [];
  const where = { curriculumId: { in: curriculumIds } };
  const [students, assignments, materials] = await Promise.all([
    db.studentSubject.findMany({
      where,
      select: { curriculumId: true },
      distinct: ['curriculumId'],
    }),
    db.facultyAssignment.findMany({
      where,
      select: { curriculumId: true },
      distinct: ['curriculumId'],
    }),
    db.libraryMaterial.findMany({
      where,
      select: { curriculumId: true },
      distinct: ['curriculumId'],
    }),
  ]);
  const ids = [...students, ...assignments, ...materials].flatMap((r) =>
    r.curriculumId ? [r.curriculumId] : []
  );
  for (const check of usageChecks) ids.push(...(await check(db, curriculumIds)));
  return [...new Set(ids)];
}

/**
 * Curricula of a category and of every category below it (ADR-0005). Callers that still
 * pass a frontline tab id get the curricula of its leaves, as before the tree existed.
 */
export async function categoryScope(
  db: Db,
  categoryId: string
): Promise<Prisma.CurriculumWhereInput> {
  const category = await db.category.findUnique({
    where: { id: categoryId },
    select: { path: true },
  });
  if (!category) return { categoryId };
  return { category: { OR: [{ id: categoryId }, { path: { startsWith: `${category.path}/` } }] } };
}

/** Maps unique-constraint violations to a 409 with a clear message. */
export function rethrowConflict(err: unknown, message: string, code: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new ConflictError(message, { code, rootCause: err });
  }
  throw err;
}

export async function audit(
  actor: Actor,
  action: string,
  resourceId: string,
  previousValue: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null
): Promise<void> {
  try {
    await logAction({
      traceId: getTraceId() ?? null,
      actorId: actor.userId,
      entity: 'catalogue_node',
      action,
      resourceId,
      previousValue,
      newValue,
    });
  } catch (err) {
    // The change is already committed; record the failure instead of failing the request
    logger.error({ err, action, resourceId }, 'Failed to write catalogue audit entry');
  }
}

// ── Internal API for pricing, faculty and library (no HTTP) ────────────────

export interface OfferingSummary {
  curriculumId: string;
  nodeId: string | null;
  categoryId: string;
  categoryName: string;
  boardId: string | null;
  boardName: string | null;
  /** Null for a leaf's category curriculum (the leaf itself is the choice) */
  subjectId: string | null;
  /** The subject, or the leaf's name for a category curriculum */
  subjectName: string;
  levelId: string | null;
  levelName: string | null;
  isActive: boolean;
}

const offeringInclude = {
  category: { select: { name: true, path: true, depth: true, isActive: true } },
  board: { select: { name: true, isActive: true } },
  subject: { select: { name: true, isActive: true } },
  level: { select: { name: true, isActive: true } },
} satisfies Prisma.CurriculumInclude;

type OfferingRow = Prisma.CurriculumGetPayload<{ include: typeof offeringInclude }>;

/**
 * Display label of each row's category: the names from the frontline tab down to the
 * leaf, e.g. "School › K-12" (ADR-0005). The root ("Academic") is left out. One query.
 */
async function categoryLabels(db: Db, rows: OfferingRow[]): Promise<Map<string, string>> {
  const prefixes = new Set<string>();
  for (const row of rows) {
    const parts = row.category.path.split('/');
    for (let i = 2; i < parts.length; i += 1) prefixes.add(parts.slice(0, i).join('/'));
  }
  const ancestors = prefixes.size
    ? await db.category.findMany({
        where: { path: { in: [...prefixes] } },
        select: { path: true, name: true },
      })
    : [];
  const names = new Map(ancestors.map((a) => [a.path, a.name]));
  const labels = new Map<string, string>();
  for (const row of rows) {
    const parts = row.category.path.split('/');
    const chain = [];
    for (let i = 2; i < parts.length; i += 1)
      chain.push(names.get(parts.slice(0, i).join('/')) ?? parts[i - 1]);
    labels.set(row.categoryId, [...chain, row.category.name].join(' › '));
  }
  return labels;
}

function toOffering(row: OfferingRow, labels: Map<string, string>): OfferingSummary {
  return {
    curriculumId: row.id,
    nodeId: row.nodeId,
    categoryId: row.categoryId,
    categoryName: labels.get(row.categoryId) ?? row.category.name,
    boardId: row.boardId,
    boardName: row.board?.name ?? null,
    subjectId: row.subjectId,
    subjectName: row.subject?.name ?? row.category.name,
    levelId: row.levelId,
    levelName: row.level?.name ?? null,
    // Bookable only while the curriculum and every master row it uses are active
    isActive:
      row.isActive &&
      row.category.isActive &&
      (row.subject === null || row.subject.isActive) &&
      (row.level === null || row.level.isActive) &&
      (row.board === null || row.board.isActive),
  };
}

/** Offerings by curriculum id, with labels (pricing rows, faculty assignments). */
export async function getOfferings(
  curriculumIds: string[],
  db: Db = prisma
): Promise<Map<string, OfferingSummary>> {
  const rows = await db.curriculum.findMany({
    where: { id: { in: curriculumIds } },
    include: offeringInclude,
  });
  const labels = await categoryLabels(db, rows);
  return new Map(rows.map((r) => [r.id, toOffering(r, labels)]));
}

/** Offerings matching a (category, subject, level) and optional board; several when the board is omitted. */
export async function findOfferings(
  filter: { categoryId: string; subjectId: string; levelId: string; boardId?: string | null },
  db: Db = prisma
): Promise<OfferingSummary[]> {
  const rows = await db.curriculum.findMany({
    where: {
      ...(await categoryScope(db, filter.categoryId)),
      subjectId: filter.subjectId,
      levelId: filter.levelId,
      ...(filter.boardId !== undefined ? { boardId: filter.boardId } : {}),
    },
    include: offeringInclude,
    orderBy: { id: 'asc' },
  });
  const labels = await categoryLabels(db, rows);
  return rows.map((r) => toOffering(r, labels));
}

/** Throws unless the curriculum exists and is bookable (published leaf, active master rows). */
export async function assertBookableCurriculum(
  curriculumId: string,
  db: Db = prisma
): Promise<OfferingSummary> {
  const offering = (await getOfferings([curriculumId], db)).get(curriculumId);
  if (!offering) throw new ValidationError('Unknown curriculum', { code: 'UNKNOWN_CURRICULUM' });
  if (!offering.isActive)
    throw new ValidationError('Curriculum is not active', { code: 'INACTIVE_CURRICULUM' });
  return offering;
}

/** Ancestors of a node, from the category root down to the direct parent. */
export async function getAncestors(
  nodeId: string
): Promise<{ id: string; type: TreeNodeRow['type']; name: string }[]> {
  const node = await prisma.catalogueNode.findUnique({
    where: { id: nodeId },
    select: { rootId: true },
  });
  if (!node) throw new NotFoundError('Catalogue node');
  const { index } = await loadCategory(prisma, node.rootId);
  return index.ancestors(nodeId).map((a) => ({ id: a.id, type: a.type, name: a.name }));
}
