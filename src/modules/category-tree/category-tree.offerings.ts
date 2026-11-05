import { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { logger } from '@core/logger/index';
import { toTreeError, treeError } from './category-tree.errors.js';
import { invalidateAdminTree, type Db } from './category-tree.reads.js';
import { checkSelection, type SelectionError } from './category-tree.rules.js';
import type { AddOfferingInput } from './category-tree.dto.js';
import { checkDeferredConstraints, type Actor } from './category-tree.service.js';

/**
 * Offerings of a bookable leaf: its curricula, each a (subject, board?, level?) choice.
 * A leaf's subject and board options are the distinct values of its active curricula;
 * its level options come from category_levels (ADR-0005).
 */

export interface OfferingView {
  curriculumId: string;
  categoryId: string;
  subject: { id: string; name: string };
  board: { id: string; name: string } | null;
  level: { id: string; name: string } | null;
  isActive: boolean;
}

const offeringInclude = {
  subject: { select: { id: true, name: true, isActive: true } },
  board: { select: { id: true, name: true, isActive: true } },
  level: { select: { id: true, name: true, isActive: true } },
} satisfies Prisma.CurriculumInclude;

function toView(
  row: Prisma.CurriculumGetPayload<{ include: typeof offeringInclude }>
): OfferingView {
  return {
    curriculumId: row.id,
    categoryId: row.categoryId,
    subject: { id: row.subject.id, name: row.subject.name },
    board: row.board ? { id: row.board.id, name: row.board.name } : null,
    level: row.level ? { id: row.level.id, name: row.level.name } : null,
    isActive: row.isActive,
  };
}

export async function listOfferings(categoryId: string): Promise<OfferingView[]> {
  const exists = await prisma.category.count({ where: { id: categoryId } });
  if (!exists) throw treeError('CATEGORY_NOT_FOUND');
  const rows = await prisma.curriculum.findMany({
    where: { categoryId },
    include: offeringInclude,
    orderBy: [{ subject: { sortOrder: 'asc' } }, { subject: { name: 'asc' } }, { id: 'asc' }],
  });
  return rows.map(toView);
}

interface LeafRow {
  id: string;
  name: string;
  is_bookable: boolean;
  requires_board: boolean;
  requires_level: boolean;
}

const SELECTION_MESSAGE: Record<SelectionError, (leaf: string) => string> = {
  NOT_BOOKABLE: (leaf) => `${leaf} is not bookable. Turn on booking for it first.`,
  BOARD_REQUIRED: (leaf) => `${leaf} requires a board`,
  LEVEL_REQUIRED: (leaf) => `${leaf} requires a level`,
  LEVEL_NOT_ALLOWED: (leaf) => `That level is not one of the levels ${leaf} allows`,
};

/** Adds an offering to a leaf. Adding an identical one again returns it (idempotent). */
export async function addOffering(
  categoryId: string,
  input: AddOfferingInput,
  actor: Actor
): Promise<{ offering: OfferingView; created: boolean }> {
  let result: { id: string; created: boolean };
  try {
    result = await prisma.$transaction(async (tx) => {
      // FOR SHARE: the leaf's flags cannot change until this offering is committed
      const [leaf] = await tx.$queryRaw<LeafRow[]>`
        SELECT id, name, is_bookable, requires_board, requires_level FROM categories
        WHERE id = ${categoryId}::uuid FOR SHARE`;
      if (!leaf) throw treeError('CATEGORY_NOT_FOUND');
      const allowed = await tx.categoryLevel.findMany({
        where: { categoryId },
        select: { levelId: true },
      });
      const error = checkSelection(
        {
          isBookable: leaf.is_bookable,
          requiresBoard: leaf.requires_board,
          requiresLevel: leaf.requires_level,
          allowedLevelIds: new Set(allowed.map((a) => a.levelId)),
        },
        input
      );
      if (error) throw treeError(error, SELECTION_MESSAGE[error](leaf.name));

      const subject = await tx.subject.findFirst({
        where: { id: input.subjectId, isActive: true },
      });
      if (!subject) throw treeError('UNKNOWN_SUBJECT');
      if (
        input.boardId &&
        !(await tx.board.findFirst({ where: { id: input.boardId, isActive: true } }))
      ) {
        throw treeError('UNKNOWN_BOARD');
      }
      if (
        input.levelId &&
        !(await tx.level.findFirst({ where: { id: input.levelId, isActive: true } }))
      ) {
        throw treeError('INACTIVE_LEVEL');
      }

      const key = {
        categoryId,
        subjectId: input.subjectId,
        boardId: input.boardId ?? null,
        levelId: input.levelId ?? null,
      };
      const existing = await tx.curriculum.findFirst({ where: key, select: { id: true } });
      if (existing) return { id: existing.id, created: false };
      const created = await tx.curriculum.create({
        data: { ...key, isActive: true },
        select: { id: true },
      });
      await checkDeferredConstraints(tx);
      return { id: created.id, created: true };
    });
  } catch (err) {
    throw toTreeError(err);
  }
  await invalidateAdminTree();
  if (result.created)
    logger.info({ categoryId, curriculumId: result.id, actorId: actor.userId }, 'Offering added');
  const row = await prisma.curriculum.findUniqueOrThrow({
    where: { id: result.id },
    include: offeringInclude,
  });
  return { offering: toView(row), created: result.created };
}

export async function setOfferingActive(
  curriculumId: string,
  isActive: boolean,
  actor: Actor
): Promise<OfferingView> {
  const row = await prisma.curriculum.findUnique({ where: { id: curriculumId } });
  if (!row) throw treeError('NO_OFFERING', 'Offering not found');
  const updated = await prisma.curriculum.update({
    where: { id: curriculumId },
    data: { isActive },
    include: offeringInclude,
  });
  await invalidateAdminTree();
  logger.info({ curriculumId, isActive, actorId: actor.userId }, 'Offering status changed');
  return toView(updated);
}

// ── Learner visibility ───────────────────────────────────────────────────────

/**
 * SQL condition: the category is active and no ancestor is inactive (invariant 8).
 * left()= is an exact prefix test, so "_" in codes is never a wildcard.
 */
export function visibleTo(alias: string): Prisma.Sql {
  const c = Prisma.raw(alias);
  return Prisma.sql`${c}.is_active AND NOT EXISTS (
    SELECT 1 FROM categories inactive_ancestor
    WHERE NOT inactive_ancestor.is_active
      AND left(${c}.path, length(inactive_ancestor.path) + 1) = inactive_ancestor.path || '/')`;
}

/** SQL condition: the leaf is bookable, visible, and offers at least one active curriculum. */
export function bookableLeaf(alias: string): Prisma.Sql {
  const c = Prisma.raw(alias);
  return Prisma.sql`${c}.is_bookable AND ${visibleTo(alias)} AND EXISTS (
    SELECT 1 FROM curricula cu JOIN subjects s ON s.id = cu.subject_id
    WHERE cu.category_id = ${c}.id AND cu.is_active AND s.is_active)`;
}

export interface BookableOffering {
  curriculumId: string;
  categoryId: string;
  categoryPath: string;
  subjectId: string;
  boardId: string | null;
  levelId: string | null;
}

/**
 * The check every booking (and student profile) write must make: the category is a
 * visible bookable leaf, the board and level follow its rules, and an active curriculum
 * exists for the choice. Pass `tx` to run inside the caller's transaction.
 */
export async function resolveBookableOffering(
  choice: {
    categoryId: string;
    subjectId: string;
    boardId?: string | null;
    levelId?: string | null;
  },
  db: Db = prisma
): Promise<BookableOffering> {
  const [leaf] = await db.$queryRaw<(LeafRow & { path: string; visible: boolean })[]>`
    SELECT c.id, c.name, c.path, c.is_bookable, c.requires_board, c.requires_level,
           (${visibleTo('c')}) AS visible
    FROM categories c WHERE c.id = ${choice.categoryId}::uuid`;
  if (!leaf || !leaf.visible) throw treeError('CATEGORY_NOT_FOUND');
  const allowed = await db.categoryLevel.findMany({
    where: { categoryId: leaf.id, level: { isActive: true } },
    select: { levelId: true },
  });
  const error = checkSelection(
    {
      isBookable: leaf.is_bookable,
      requiresBoard: leaf.requires_board,
      requiresLevel: leaf.requires_level,
      allowedLevelIds: new Set(allowed.map((a) => a.levelId)),
    },
    choice
  );
  if (error) throw treeError(error, SELECTION_MESSAGE[error](leaf.name));

  const curriculum = await db.curriculum.findFirst({
    where: {
      categoryId: leaf.id,
      subjectId: choice.subjectId,
      boardId: choice.boardId ?? null,
      levelId: choice.levelId ?? null,
      isActive: true,
      subject: { isActive: true },
    },
    include: { board: { select: { isActive: true } } },
  });
  if (!curriculum || (curriculum.board && !curriculum.board.isActive))
    throw treeError('NO_OFFERING');
  return {
    curriculumId: curriculum.id,
    categoryId: leaf.id,
    categoryPath: leaf.path,
    subjectId: curriculum.subjectId,
    boardId: curriculum.boardId,
    levelId: curriculum.levelId,
  };
}
