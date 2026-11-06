import { randomUUID } from 'crypto';
import { prisma } from '@infrastructure/database/index';

/**
 * Category-tree fixtures (ADR-0005) written straight to the database, so suites never
 * depend on the module's HTTP API. Paths and depths are computed here the same way the
 * service does, so the deferred tree trigger accepts them. Whether a node is a leaf
 * (is_bookable) and its category curriculum are kept by the categories_leaf_sync
 * trigger, so the booking flags passed here are normalised by the database.
 */

const unique = () => randomUUID().slice(0, 8);

export interface TreeNodeFixture {
  id: string;
  code: string;
  name: string;
  path: string;
  depth: number;
  version: number;
}

export async function createTreeNode(
  parent: { id: string; path: string; depth: number } | null,
  overrides: {
    code?: string;
    name?: string;
    isBookable?: boolean;
    requiresBoard?: boolean;
    requiresLevel?: boolean;
    isActive?: boolean;
    displayOrder?: number;
  } = {}
): Promise<TreeNodeFixture> {
  const code = overrides.code ?? `node-${unique()}`;
  return prisma.category.create({
    data: {
      parentId: parent?.id ?? null,
      code,
      name: overrides.name ?? code,
      path: parent ? `${parent.path}/${code}` : code,
      depth: parent ? parent.depth + 1 : 0,
      isBookable: overrides.isBookable ?? false,
      requiresBoard: overrides.requiresBoard ?? false,
      requiresLevel: overrides.requiresLevel ?? false,
      isActive: overrides.isActive ?? true,
      displayOrder: overrides.displayOrder ?? 0,
    },
    select: { id: true, code: true, name: true, path: true, depth: true, version: true },
  });
}

export async function createLookups() {
  const tag = unique();
  const [board, subject, subject2, level, level2] = await Promise.all([
    prisma.board.create({ data: { code: `board-${tag}`, name: `Board ${tag}` } }),
    prisma.subject.create({ data: { code: `physics-${tag}`, name: `Physics ${tag}` } }),
    prisma.subject.create({ data: { code: `chem-${tag}`, name: `Chemistry ${tag}` } }),
    prisma.level.create({
      data: { code: `class-11-${tag}`, name: `Class 11 ${tag}`, sortOrder: 11 },
    }),
    prisma.level.create({
      data: { code: `class-12-${tag}`, name: `Class 12 ${tag}`, sortOrder: 12 },
    }),
  ]);
  return { board, subject, subject2, level, level2 };
}

export async function allowLevels(categoryId: string, levelIds: string[]): Promise<void> {
  await prisma.categoryLevel.createMany({
    data: levelIds.map((levelId) => ({ categoryId, levelId })),
    skipDuplicates: true,
  });
}

export async function createOffering(data: {
  categoryId: string;
  subjectId: string;
  boardId?: string | null;
  levelId?: string | null;
  isActive?: boolean;
}) {
  return prisma.curriculum.create({
    data: {
      categoryId: data.categoryId,
      subjectId: data.subjectId,
      boardId: data.boardId ?? null,
      levelId: data.levelId ?? null,
      isActive: data.isActive ?? true,
    },
  });
}

export async function setFlag(name: string, isEnabled: boolean): Promise<void> {
  await prisma.featureFlag.upsert({
    where: { name },
    create: { name, isEnabled },
    update: { isEnabled },
  });
}

/** The category curriculum of a leaf (no subject, board or level): what tutors pick. */
export async function leafCurriculum(categoryId: string) {
  return prisma.curriculum.findFirstOrThrow({
    where: { categoryId, subjectId: null, boardId: null, levelId: null },
  });
}

/** A default (all tutors) price on a curriculum, which puts its category in use. */
export async function priceCurriculum(curriculumId: string, sessionPricePaise = 100000) {
  const gstPaise = Math.floor((sessionPricePaise * 1800 + 5000) / 10000);
  return prisma.priceRule.create({
    data: {
      curriculumId,
      sessionPricePaise,
      gstPaise,
      studentPaysPaise: sessionPricePaise + gstPaise,
    },
  });
}
