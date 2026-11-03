import { prisma } from '@infrastructure/database/index.js';

/** A student profile for a user, with the smallest catalogue behind it (created through the database). */
export async function createStudentProfile(
  userId: string,
  country: string,
  dateOfBirth = '2012-05-15'
): Promise<{ id: string }> {
  const category = await prisma.category.upsert({
    where: { code: 'SKILL' },
    update: {},
    create: { code: 'SKILL', name: 'Skill learning' },
  });
  const level = await prisma.level.upsert({
    where: { code: 'BEGINNER' },
    update: {},
    create: { code: 'BEGINNER', name: 'Beginner' },
  });
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
