import { randomUUID } from 'crypto';
import { prisma } from '@infrastructure/database/index';

/** A faculty profile with its user, created directly in the database. */
export async function createFacultyProfile(fullName = 'Test Tutor', overrides: { isActive?: boolean } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `tutor-${randomUUID()}@test.com`,
      passwordHash: 'not-used-in-these-tests',
      fullName,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  return prisma.facultyProfile.create({ data: { userId: user.id, isActive: overrides.isActive ?? true } });
}
