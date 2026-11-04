import { prisma } from '@infrastructure/database/index.js';
import { allowLevels, createTreeNode } from './category-tree.js';

/** A student profile for a user, with the smallest catalogue behind it (created through the database). */
export async function createStudentProfile(
  userId: string,
  country: string,
  dateOfBirth = '2012-05-15'
): Promise<{ id: string }> {
  // A student profile must point at a bookable leaf that allows its level (ADR-0005)
  const root = await prisma.category.findFirst({ where: { code: 'test-root', parentId: null } });
  const parent = root ?? (await createTreeNode(null, { code: 'test-root' }));
  const category = await createTreeNode(parent, {
    name: 'Skill learning',
    isBookable: true,
    requiresLevel: true,
  });
  const level = await prisma.level.upsert({
    where: { code: 'BEGINNER' },
    update: {},
    create: { code: 'BEGINNER', name: 'Beginner' },
  });
  await allowLevels(category.id, [level.id]);
  const language = await prisma.teachingLanguage.upsert({
    where: { code: 'en' },
    update: {},
    create: { code: 'en', name: 'English', languageCodes: ['en'] },
  });
  return prisma.studentProfile.create({
    data: {
      userId,
      country,
      dateOfBirth: new Date(`${dateOfBirth}T00:00:00Z`),
      categoryId: category.id,
      levelId: level.id,
      teachingLanguageId: language.id,
    },
    select: { id: true },
  });
}
