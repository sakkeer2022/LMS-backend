import type { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { toPrismaPagination } from '@shared/validation/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import type { CurriculumListQuery, LevelListQuery, MasterListQuery } from './catalogue.dto.js';

/**
 * List-only reads of the master tables (categories, boards, subjects, levels)
 * and curricula. Admin create/edit of master rows is deferred (D12).
 * Public callers pass `isActive: true`; admin callers may filter either way.
 */

export interface CategoryView {
  id: string;
  code: string;
  name: string;
  requiresBoard: boolean;
  isActive: boolean;
}

export interface MasterView {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export interface LevelView extends MasterView {
  categoryId: string | null;
}

export interface CurriculumView {
  id: string;
  categoryId: string;
  boardId: string | null;
  subjectId: string;
  levelId: string;
  nodeId: string | null;
  name: string;
  syllabus: string | null;
  isActive: boolean;
}

const masterOrder = [
  { sortOrder: 'asc' as const },
  { name: 'asc' as const },
  { id: 'asc' as const },
];

export async function listCategories(
  query: MasterListQuery
): Promise<PaginatedResult<CategoryView>> {
  const where: Prisma.CategoryWhereInput =
    query.isActive === undefined ? {} : { isActive: query.isActive };
  const [rows, total] = await Promise.all([
    prisma.category.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      ...toPrismaPagination(query),
    }),
    prisma.category.count({ where }),
  ]);
  return {
    items: rows.map(({ id, code, name, requiresBoard, isActive }) => ({
      id,
      code,
      name,
      requiresBoard,
      isActive,
    })),
    meta: buildPaginationMeta(total, query.page, query.limit),
  };
}

export async function listBoards(query: MasterListQuery): Promise<PaginatedResult<MasterView>> {
  const where: Prisma.BoardWhereInput =
    query.isActive === undefined ? {} : { isActive: query.isActive };
  const [rows, total] = await Promise.all([
    prisma.board.findMany({ where, orderBy: masterOrder, ...toPrismaPagination(query) }),
    prisma.board.count({ where }),
  ]);
  return {
    items: rows.map(toMasterView),
    meta: buildPaginationMeta(total, query.page, query.limit),
  };
}

export async function listSubjects(query: MasterListQuery): Promise<PaginatedResult<MasterView>> {
  const where: Prisma.SubjectWhereInput =
    query.isActive === undefined ? {} : { isActive: query.isActive };
  const [rows, total] = await Promise.all([
    prisma.subject.findMany({ where, orderBy: masterOrder, ...toPrismaPagination(query) }),
    prisma.subject.count({ where }),
  ]);
  return {
    items: rows.map(toMasterView),
    meta: buildPaginationMeta(total, query.page, query.limit),
  };
}

export async function listLevels(query: LevelListQuery): Promise<PaginatedResult<LevelView>> {
  const where: Prisma.LevelWhereInput = {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.level.findMany({ where, orderBy: masterOrder, ...toPrismaPagination(query) }),
    prisma.level.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({ ...toMasterView(row), categoryId: row.categoryId })),
    meta: buildPaginationMeta(total, query.page, query.limit),
  };
}

const curriculumInclude = {
  board: { select: { name: true } },
  subject: { select: { name: true } },
  level: { select: { name: true } },
} satisfies Prisma.CurriculumInclude;

/**
 * Curricula filtered by category, board and level (onboarding step 2 and LMS-99).
 * The public projection also hides curricula whose master rows are inactive.
 */
export async function listCurricula(
  query: CurriculumListQuery,
  options: { publicOnly: boolean }
): Promise<PaginatedResult<CurriculumView>> {
  const where: Prisma.CurriculumWhereInput = {
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.boardId ? { boardId: query.boardId } : {}),
    ...(query.levelId ? { levelId: query.levelId } : {}),
    ...(options.publicOnly
      ? {
          isActive: true,
          category: { isActive: true },
          subject: { isActive: true },
          level: { isActive: true },
          OR: [{ boardId: null }, { board: { isActive: true } }],
        }
      : query.isActive === undefined
        ? {}
        : { isActive: query.isActive }),
  };
  const [rows, total] = await Promise.all([
    prisma.curriculum.findMany({
      where,
      include: curriculumInclude,
      orderBy: [{ subject: { sortOrder: 'asc' } }, { subject: { name: 'asc' } }, { id: 'asc' }],
      ...toPrismaPagination(query),
    }),
    prisma.curriculum.count({ where }),
  ]);
  return {
    items: rows.map(toCurriculumView),
    meta: buildPaginationMeta(total, query.page, query.limit),
  };
}

function toMasterView(row: {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}): MasterView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

function toCurriculumView(
  row: Prisma.CurriculumGetPayload<{ include: typeof curriculumInclude }>
): CurriculumView {
  return {
    id: row.id,
    categoryId: row.categoryId,
    boardId: row.boardId,
    subjectId: row.subjectId,
    levelId: row.levelId,
    nodeId: row.nodeId,
    // Display label composed from the master names; curricula have no stored name
    name: [row.board?.name, row.subject.name, row.level.name].filter(Boolean).join(' · '),
    syllabus: row.syllabus,
    isActive: row.isActive,
  };
}
