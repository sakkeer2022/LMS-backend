import type { CatalogueNode, CatalogueNodeType, Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { ConflictError, NotFoundError, ValidationError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { checkPlacement, placementMessage, slugify } from './catalogue.tree.js';
import {
  audit,
  curriculaInUse,
  getNodeDetail,
  getRootForCategory,
  loadCategory,
  rethrowConflict,
  syncCurricula,
  type Actor,
  type NodeDetail,
} from './catalogue.service.js';
import type {
  CreateNodeInput,
  CreatePathInput,
  MoveNodeInput,
  ReorderNodesInput,
  UpdateNodeInput,
} from './catalogue.dto.js';

/**
 * Catalogue tree writes (ADR 0003). Every write runs in one transaction that
 * also keeps the leaves' curricula in sync, then records an audit entry.
 * Policies: new nodes start as DRAFT (D10); archive is blocked while a child
 * is not archived (D3); move is blocked while the subtree's curricula are in use (D16).
 */

type Tx = Prisma.TransactionClient;
type MasterType = Extract<CatalogueNodeType, 'BOARD' | 'SUBJECT' | 'LEVEL'>;

/** The master-reference column a node of `type` carries. */
function masterRef(
  type: MasterType,
  id: string
): { boardId: string } | { subjectId: string } | { levelId: string } {
  if (type === 'BOARD') return { boardId: id };
  if (type === 'SUBJECT') return { subjectId: id };
  return { levelId: id };
}

function masterIdOf(input: CreateNodeInput): string | undefined {
  if (input.type === 'BOARD') return input.boardId;
  if (input.type === 'SUBJECT') return input.subjectId;
  if (input.type === 'LEVEL') return input.levelId;
  return undefined;
}

function snapshot(node: CatalogueNode): Record<string, unknown> {
  return {
    parentId: node.parentId,
    type: node.type,
    name: node.name,
    slug: node.slug,
    status: node.status,
    sortOrder: node.sortOrder,
    boardId: node.boardId,
    subjectId: node.subjectId,
    levelId: node.levelId,
    bookingEnabled: node.bookingEnabled,
  };
}

async function findNode(tx: Tx, id: string, label = 'Catalogue node'): Promise<CatalogueNode> {
  const node = await tx.catalogueNode.findUnique({ where: { id } });
  if (!node) throw new NotFoundError(label);
  return node;
}

async function requiresBoardFor(tx: Tx, rootId: string): Promise<boolean> {
  const root = await tx.catalogueNode.findUnique({
    where: { id: rootId },
    include: { category: { select: { requiresBoard: true } } },
  });
  return root?.category?.requiresBoard ?? false;
}

/** Loads an active master row and checks a level's category scope. */
async function loadMaster(
  tx: Tx,
  type: MasterType,
  id: string,
  categoryId: string | null
): Promise<{ name: string; code: string }> {
  const row =
    type === 'BOARD'
      ? await tx.board.findUnique({ where: { id } })
      : type === 'SUBJECT'
        ? await tx.subject.findUnique({ where: { id } })
        : await tx.level.findUnique({ where: { id } });
  const label = type.toLowerCase();
  if (!row) throw new ValidationError(`Unknown ${label}`, { code: `UNKNOWN_${type}` });
  if (!row.isActive)
    throw new ValidationError(`The ${label} is not active`, { code: `INACTIVE_${type}` });
  if (type === 'LEVEL' && 'categoryId' in row && row.categoryId && row.categoryId !== categoryId) {
    throw new ValidationError('The level belongs to another category', {
      code: 'LEVEL_CATEGORY_MISMATCH',
    });
  }
  return row;
}

async function categoryIdFor(tx: Tx, rootId: string): Promise<string | null> {
  const root = await tx.catalogueNode.findUnique({
    where: { id: rootId },
    select: { categoryId: true },
  });
  return root?.categoryId ?? null;
}

async function nextSortOrder(tx: Tx, parentId: string): Promise<number> {
  const last = await tx.catalogueNode.aggregate({ where: { parentId }, _max: { sortOrder: true } });
  return (last._max.sortOrder ?? 0) + 1;
}

function assertPlacement(
  type: CatalogueNodeType,
  parentType: CatalogueNodeType,
  requiresBoard: boolean
): void {
  const error = checkPlacement(type, parentType, requiresBoard);
  if (error) throw new ValidationError(placementMessage(error), { code: error });
}

function assertParentUsable(parent: CatalogueNode): void {
  if (parent.status === 'ARCHIVED') {
    throw new ValidationError('The parent node is archived', { code: 'ARCHIVED_PARENT' });
  }
}

/** Rejects a second leaf for a combination that already exists elsewhere in the tree (D11 limitation). */
async function assertCombinationFree(
  tx: Tx,
  tuple: { categoryId: string; boardId: string | null; subjectId: string; levelId: string }
): Promise<void> {
  const taken = await tx.curriculum.findFirst({
    where: { ...tuple, nodeId: { not: null } },
    select: { id: true },
  });
  if (taken) {
    throw new ConflictError(
      'This category, board, subject and level combination already exists in the tree. It can appear only once, even under another subsection.',
      { code: 'COMBINATION_EXISTS' }
    );
  }
}

async function syncOrConflict(tx: Tx, rootId: string): Promise<void> {
  try {
    await syncCurricula(tx, rootId);
  } catch (err) {
    rethrowConflict(
      err,
      'The change would duplicate an existing offering combination',
      'COMBINATION_EXISTS'
    );
  }
}

// ── Add path (screen 28a) ──────────────────────────────────────────────────

export interface CreatePathResult {
  leaf: NodeDetail;
  createdNodeIds: string[];
}

export async function createPath(input: CreatePathInput, actor: Actor): Promise<CreatePathResult> {
  const { leafId, createdNodeIds } = await prisma.$transaction(async (tx) => {
    const { root, requiresBoard } = await getRootForCategory(tx, input.categoryId);
    if (requiresBoard && !input.boardId) {
      throw new ValidationError('A board is required in this category', { code: 'BOARD_REQUIRED' });
    }
    if (!requiresBoard && input.boardId) {
      throw new ValidationError('Boards are allowed only in categories that require a board', {
        code: 'BOARD_NOT_ALLOWED',
      });
    }

    let parent: CatalogueNode = root;
    if (input.subsectionNodeId) {
      const sub = await findNode(tx, input.subsectionNodeId, 'Subsection');
      if (sub.type !== 'SUBSECTION' || sub.parentId !== root.id) {
        throw new ValidationError('The subsection does not belong to this category', {
          code: 'INVALID_SUBSECTION',
        });
      }
      assertParentUsable(sub);
      parent = sub;
    }

    const created: string[] = [];
    const reuseOrCreate = async (type: MasterType, masterId: string): Promise<CatalogueNode> => {
      const master = await loadMaster(tx, type, masterId, input.categoryId);
      const ref = masterRef(type, masterId);
      const existing = await tx.catalogueNode.findFirst({ where: { parentId: parent.id, ...ref } });
      if (existing) {
        if (type === 'LEVEL')
          throw new ConflictError('This path already exists', { code: 'PATH_EXISTS' });
        assertParentUsable(existing);
        return existing;
      }
      const node = await tx.catalogueNode
        .create({
          data: {
            parentId: parent.id,
            rootId: root.id,
            type,
            name: master.name,
            slug: master.code,
            status: input.status,
            sortOrder: await nextSortOrder(tx, parent.id),
            ...ref,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        })
        .catch((err: unknown) =>
          rethrowConflict(
            err,
            `A sibling already uses the slug "${master.code}"`,
            'DUPLICATE_SIBLING'
          )
        );
      created.push(node.id);
      return node;
    };

    if (input.boardId) parent = await reuseOrCreate('BOARD', input.boardId);
    parent = await reuseOrCreate('SUBJECT', input.subjectId);
    await assertCombinationFree(tx, {
      categoryId: input.categoryId,
      boardId: input.boardId ?? null,
      subjectId: input.subjectId,
      levelId: input.levelId,
    });
    const leaf = await reuseOrCreate('LEVEL', input.levelId);
    await syncOrConflict(tx, root.id);
    return { leafId: leaf.id, createdNodeIds: created };
  });

  logger.info({ leafId, createdNodeIds, actorId: actor.userId }, 'Catalogue path created');
  for (const id of createdNodeIds) await audit(actor, 'create', id, null, { via: 'path', leafId });
  return { leaf: await getNodeDetail(leafId, { publicOnly: false }), createdNodeIds };
}

// ── Single node writes ─────────────────────────────────────────────────────

export async function createNode(input: CreateNodeInput, actor: Actor): Promise<NodeDetail> {
  const node = await prisma.$transaction(async (tx) => {
    const parent = await tx.catalogueNode.findUnique({ where: { id: input.parentId } });
    if (!parent) throw new ValidationError('Unknown parent node', { code: 'UNKNOWN_PARENT' });
    assertParentUsable(parent);
    assertPlacement(input.type, parent.type, await requiresBoardFor(tx, parent.rootId));

    // The DTO guarantees a name for subsections and a master id for the other types
    const masterId = masterIdOf(input);
    const master =
      input.type !== 'SUBSECTION' && masterId
        ? await loadMaster(tx, input.type, masterId, await categoryIdFor(tx, parent.rootId))
        : null;
    const name = input.name ?? master?.name;
    if (!name) throw new ValidationError('name is required', { code: 'NAME_REQUIRED' });
    const slug = input.slug ?? master?.code ?? slugify(name);

    const created = await tx.catalogueNode
      .create({
        data: {
          parentId: parent.id,
          rootId: parent.rootId,
          type: input.type,
          name,
          slug,
          status: input.status,
          sortOrder: input.sortOrder ?? (await nextSortOrder(tx, parent.id)),
          boardId: input.boardId ?? null,
          subjectId: input.subjectId ?? null,
          levelId: input.levelId ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      })
      .catch((err: unknown) =>
        rethrowConflict(
          err,
          'A sibling already uses this slug or master value',
          'DUPLICATE_SIBLING'
        )
      );

    if (created.type === 'LEVEL') {
      const { index } = await loadCategory(tx, created.rootId);
      const offering = index.offeringOf(created.id);
      if (offering) await assertCombinationFree(tx, offering);
      await syncOrConflict(tx, created.rootId);
    }
    return created;
  });

  logger.info(
    { nodeId: node.id, type: node.type, actorId: actor.userId },
    'Catalogue node created'
  );
  await audit(actor, 'create', node.id, null, snapshot(node));
  return getNodeDetail(node.id, { publicOnly: false });
}

export async function updateNode(
  id: string,
  input: UpdateNodeInput,
  actor: Actor
): Promise<NodeDetail> {
  const { before, after } = await prisma.$transaction(async (tx) => {
    const node = await findNode(tx, id);
    if (input.bookingEnabled !== undefined && node.type !== 'CATEGORY') {
      throw new ValidationError('bookingEnabled applies to category nodes only', {
        code: 'BOOKING_FLAG_NOT_ALLOWED',
      });
    }
    const restoring = node.status === 'ARCHIVED' && input.status !== undefined;
    if (restoring && node.parentId) assertParentUsable(await findNode(tx, node.parentId));

    const updated = await tx.catalogueNode
      .update({
        where: { id },
        data: { ...input, ...(restoring ? { archivedAt: null } : {}), updatedById: actor.userId },
      })
      .catch((err: unknown) =>
        rethrowConflict(err, 'A sibling already uses this slug', 'DUPLICATE_SIBLING')
      );

    if (input.status !== undefined && input.status !== node.status)
      await syncOrConflict(tx, node.rootId);
    return { before: node, after: updated };
  });

  logger.info({ nodeId: id, actorId: actor.userId }, 'Catalogue node updated');
  await audit(actor, 'update', id, snapshot(before), snapshot(after));
  return getNodeDetail(id, { publicOnly: false });
}

export async function moveNode(
  id: string,
  input: MoveNodeInput,
  actor: Actor
): Promise<NodeDetail> {
  const result = await prisma.$transaction(async (tx) => {
    const node = await findNode(tx, id);
    if (node.type === 'CATEGORY') {
      throw new ValidationError(placementMessage('CATEGORY_NOT_ALLOWED'), {
        code: 'CATEGORY_NOT_ALLOWED',
      });
    }
    const parent = await tx.catalogueNode.findUnique({ where: { id: input.parentId } });
    if (!parent) throw new ValidationError('Unknown parent node', { code: 'UNKNOWN_PARENT' });
    if (parent.id === node.parentId) return null;
    if (parent.rootId !== node.rootId) {
      throw new ValidationError('Nodes can move only within their own category', {
        code: 'CROSS_CATEGORY_MOVE',
      });
    }
    assertParentUsable(parent);

    const { index, curriculumByNode } = await loadCategory(tx, node.rootId);
    if (index.isSelfOrDescendant(node.id, parent.id)) {
      throw new ValidationError('A node cannot move under itself or one of its descendants', {
        code: 'CYCLE',
      });
    }
    assertPlacement(node.type, parent.type, await requiresBoardFor(tx, node.rootId));

    const subtreeCurricula = index
      .subtree(node.id)
      .map((n) => curriculumByNode.get(n.id))
      .filter((c): c is string => Boolean(c));
    if ((await curriculaInUse(tx, subtreeCurricula)).length > 0) {
      throw new ConflictError(
        'This node has offerings that students, tutors or library items already use, so it cannot move. Archive it and add a new path instead.',
        { code: 'NODE_IN_USE' }
      );
    }

    const moved = await tx.catalogueNode
      .update({
        where: { id },
        data: {
          parentId: parent.id,
          sortOrder: await nextSortOrder(tx, parent.id),
          updatedById: actor.userId,
        },
      })
      .catch((err: unknown) =>
        rethrowConflict(
          err,
          'The new parent already has a child with this slug or master value',
          'DUPLICATE_SIBLING'
        )
      );
    await syncOrConflict(tx, node.rootId);
    return { before: node, after: moved };
  });

  if (result) {
    logger.info(
      { nodeId: id, from: result.before.parentId, to: input.parentId, actorId: actor.userId },
      'Catalogue node moved'
    );
    await audit(actor, 'move', id, snapshot(result.before), snapshot(result.after));
  }
  return getNodeDetail(id, { publicOnly: false });
}

export async function archiveNode(id: string, actor: Actor): Promise<NodeDetail> {
  const result = await prisma.$transaction(async (tx) => {
    const node = await findNode(tx, id);
    if (node.type === 'CATEGORY') {
      throw new ValidationError('Category tabs are fixed and cannot be archived', {
        code: 'CATEGORY_NOT_ALLOWED',
      });
    }
    if (node.status === 'ARCHIVED') return null;
    const activeChildren = await tx.catalogueNode.count({
      where: { parentId: id, status: { not: 'ARCHIVED' } },
    });
    if (activeChildren > 0) {
      throw new ConflictError(`Archive the ${activeChildren} child node(s) first`, {
        code: 'HAS_ACTIVE_CHILDREN',
        context: { activeChildren },
      });
    }
    const archived = await tx.catalogueNode.update({
      where: { id },
      data: { status: 'ARCHIVED', archivedAt: new Date(), updatedById: actor.userId },
    });
    await syncOrConflict(tx, node.rootId);
    return { before: node, after: archived };
  });

  if (result) {
    logger.info({ nodeId: id, actorId: actor.userId }, 'Catalogue node archived');
    await audit(actor, 'archive', id, snapshot(result.before), snapshot(result.after));
  }
  return getNodeDetail(id, { publicOnly: false });
}

/** Sets the sibling order of every child of `parentId`; the list must name all of them. */
export async function reorderNodes(
  input: ReorderNodesInput,
  actor: Actor
): Promise<{ parentId: string; orderedIds: string[] }> {
  const previous = await prisma.$transaction(async (tx) => {
    await findNode(tx, input.parentId, 'Parent node');
    const children = await tx.catalogueNode.findMany({
      where: { parentId: input.parentId },
      select: { id: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const current = new Set(children.map((c) => c.id));
    if (
      current.size !== input.orderedIds.length ||
      input.orderedIds.some((cid) => !current.has(cid))
    ) {
      throw new ValidationError('orderedIds must list every child of the parent exactly once', {
        code: 'REORDER_MISMATCH',
      });
    }
    for (const [i, childId] of input.orderedIds.entries()) {
      await tx.catalogueNode.update({
        where: { id: childId },
        data: { sortOrder: i + 1, updatedById: actor.userId },
      });
    }
    return children.map((c) => c.id);
  });

  logger.info({ parentId: input.parentId, actorId: actor.userId }, 'Catalogue nodes reordered');
  await audit(
    actor,
    'reorder',
    input.parentId,
    { orderedIds: previous },
    { orderedIds: input.orderedIds }
  );
  return input;
}
