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

/**
 * Published path category › (subsection) › (board) › subject › level with its
 * active curriculum, built directly in the database. Expects the reference seed.
 */
export async function createPublishedOffering(codes: {
  category: string;
  subsection?: string;
  board?: string;
  subject: string;
  level: string;
}) {
  const category = await prisma.category.findUniqueOrThrow({ where: { code: codes.category } });
  const root = await prisma.catalogueNode.findUniqueOrThrow({ where: { categoryId: category.id } });
  let parent: { id: string; rootId: string } = root;

  const child = async (
    type: 'SUBSECTION' | 'BOARD' | 'SUBJECT' | 'LEVEL',
    slug: string,
    ref: { boardId?: string; subjectId?: string; levelId?: string } = {}
  ) => {
    const existing = await prisma.catalogueNode.findFirst({ where: { parentId: parent.id, slug } });
    parent = existing ?? (await createChildNode(parent, { type, slug, ...ref }));
    return parent;
  };

  if (codes.subsection) await child('SUBSECTION', codes.subsection);
  const board = codes.board ? await prisma.board.findUniqueOrThrow({ where: { code: codes.board } }) : null;
  if (board) await child('BOARD', board.code, { boardId: board.id });
  const subject = await prisma.subject.findUniqueOrThrow({ where: { code: codes.subject } });
  const subjectNode = await child('SUBJECT', subject.code, { subjectId: subject.id });
  const level = await prisma.level.findUniqueOrThrow({ where: { code: codes.level } });
  const leaf = await child('LEVEL', level.code, { levelId: level.id });

  const curriculum = await prisma.curriculum.create({
    data: {
      categoryId: category.id,
      boardId: board?.id ?? null,
      subjectId: subject.id,
      levelId: level.id,
      nodeId: leaf.id,
      isActive: true,
    },
  });
  return { curriculum, leaf, subjectNode, categoryId: category.id, boardId: board?.id ?? null, subjectId: subject.id, levelId: level.id };
}
