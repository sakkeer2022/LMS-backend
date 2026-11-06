import { prisma } from '@infrastructure/database/index.js';

/** A student profile for a user (created through the database). It has no offerings until a test adds some. */
export async function createStudentProfile(
  userId: string,
  country: string,
  dateOfBirth = '2012-05-15'
): Promise<{ id: string }> {
  return prisma.studentProfile.create({
    data: { userId, country, dateOfBirth: new Date(`${dateOfBirth}T00:00:00Z`) },
    select: { id: true },
  });
}
