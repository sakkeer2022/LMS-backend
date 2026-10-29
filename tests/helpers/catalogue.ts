import { randomUUID } from 'crypto';
import type { CatalogueNodeStatus, CatalogueNodeType } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';

/**
 * Catalogue fixtures created directly in the database, so suites never depend on
 * another module's HTTP API.
 */

const unique = () => randomUUID().slice(0, 8);

export async function createCategory(overrides: { code?: string; name?: string; requiresBoard?: boolean } = {}) {
  const code = overrides.code ?? `cat-${unique()}`;
  return prisma.category.create({
    data: { code, name: overrides.name ?? code, requiresBoard: overrides.requiresBoard ?? false },
  });
}

export async function createBoard(overrides: { code?: string; name?: string; isActive?: boolean; sortOrder?: number } = {}) {
  const code = overrides.code ?? `board-${unique()}`;
  return prisma.board.create({
    data: { code, name: overrides.name ?? code, isActive: overrides.isActive ?? true, sortOrder: overrides.sortOrder ?? 0 },
  });
}

export async function createSubject(overrides: { code?: string; name?: string; isActive?: boolean; sortOrder?: number } = {}) {
  const code = overrides.code ?? `subject-${unique()}`;
  return prisma.subject.create({
    data: { code, name: overrides.name ?? code, isActive: overrides.isActive ?? true, sortOrder: overrides.sortOrder ?? 0 },
  });
}

export async function createLevel(
  overrides: { code?: string; name?: string; categoryId?: string | null; isActive?: boolean; sortOrder?: number } = {}
) {
  const code = overrides.code ?? `level-${unique()}`;
  return prisma.level.create({
    data: {
      code,
      name: overrides.name ?? code,
      categoryId: overrides.categoryId ?? null,
      isActive: overrides.isActive ?? true,
      sortOrder: overrides.sortOrder ?? 0,
    },
  });
}

/** CATEGORY root node for a category; rootId points at the node itself. */
export async function createRootNode(categoryId: string, overrides: { status?: CatalogueNodeStatus; name?: string } = {}) {
  const id = randomUUID();
  return prisma.catalogueNode.create({
    data: {
      id,
      rootId: id,
      type: 'CATEGORY',
      name: overrides.name ?? 'Category',
      slug: `root-${unique()}`,
      status: overrides.status ?? 'PUBLISHED',
      categoryId,
    },
  });
}

export async function createChildNode(
  parent: { id: string; rootId: string },
  data: {
    type: Exclude<CatalogueNodeType, 'CATEGORY'>;
    name?: string;
    slug?: string;
    status?: CatalogueNodeStatus;
    sortOrder?: number;
    boardId?: string;
    subjectId?: string;
    levelId?: string;
  }
) {
  const slug = data.slug ?? `${data.type.toLowerCase()}-${unique()}`;
  return prisma.catalogueNode.create({
    data: {
      parentId: parent.id,
      rootId: parent.rootId,
      type: data.type,
      name: data.name ?? slug,
      slug,
      status: data.status ?? 'PUBLISHED',
      sortOrder: data.sortOrder ?? 0,
      boardId: data.boardId ?? null,
      subjectId: data.subjectId ?? null,
      levelId: data.levelId ?? null,
    },
  });
}
