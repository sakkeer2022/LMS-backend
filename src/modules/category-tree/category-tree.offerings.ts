import { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { treeError } from './category-tree.errors.js';
import { type Db } from './category-tree.reads.js';
import { checkSelection, type SelectionError } from './category-tree.rules.js';

/**
 * Learner-side checks on leaves (ADR-0005). A leaf (a category without sub-categories,
 * kept by the categories_leaf_sync trigger) offers subjects: one curriculum per leaf and
 * subject, managed by admins in category-tree.subjects.ts (migration
 * 20261110090000_leaf_subject_offerings).
 */

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

/** SQL condition: a visible leaf with an active curriculum whose subject is still active. */
export function bookableLeaf(alias: string): Prisma.Sql {
  const c = Prisma.raw(alias);
  return Prisma.sql`${c}.is_bookable AND ${visibleTo(alias)} AND EXISTS (
    SELECT 1 FROM curricula cu JOIN subjects s ON s.id = cu.subject_id
    WHERE cu.category_id = ${c}.id AND cu.is_active AND s.is_active)`;
}

/**
 * SQL condition: a visible leaf with an active subject offering (no board or level), the
 * thing tutors pick on onboarding and admins price.
 */
export function selectableLeaf(alias: string): Prisma.Sql {
  const c = Prisma.raw(alias);
  return Prisma.sql`${c}.is_bookable AND ${visibleTo(alias)} AND EXISTS (
    SELECT 1 FROM curricula cu JOIN subjects s ON s.id = cu.subject_id
    WHERE cu.category_id = ${c}.id AND cu.is_active AND s.is_active
      AND cu.board_id IS NULL AND cu.level_id IS NULL)`;
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
    subjectId: choice.subjectId,
    boardId: curriculum.boardId,
    levelId: curriculum.levelId,
  };
}
