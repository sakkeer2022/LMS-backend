import { createHash, randomUUID } from 'crypto';
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

/** A faculty invitation written straight to the database. */
export async function createInvitation(
  options: {
    email?: string;
    status?: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
    /** Created and expired in the past (the row stays PENDING until the service expires it). */
    expired?: boolean;
  } = {}
) {
  const now = Date.now();
  const createdAt = options.expired ? new Date(now - 4 * 24 * 3600 * 1000) : new Date(now);
  const expiresAt = options.expired
    ? new Date(now - 24 * 3600 * 1000)
    : new Date(now + 72 * 3600 * 1000);
  return prisma.facultyInvitation.create({
    data: {
      email: options.email ?? `invite-${randomUUID()}@test.com`,
      tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
      status: options.status ?? 'PENDING',
      createdAt,
      expiresAt,
    },
  });
}

/** A profile for the admin roster, with optional assignments, qualifications and documents. */
export async function createRosterProfile(
  options: {
    fullName?: string;
    approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
    isPublished?: boolean;
    isActive?: boolean;
    userStatus?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_ACTIVATION';
    deleted?: boolean;
    createdAt?: Date;
    curriculumIds?: string[];
    assignmentActive?: boolean;
    qualifications?: { degree: string; institution: string; yearOfPassing: number }[];
    documents?: number;
  } = {}
) {
  const user = await prisma.user.create({
    data: {
      email: `tutor-${randomUUID()}@test.com`,
      passwordHash: 'not-used-in-these-tests',
      fullName: options.fullName ?? 'Test Tutor',
      status: options.userStatus ?? 'ACTIVE',
      emailVerifiedAt: new Date(),
      deletedAt: options.deleted ? new Date() : null,
    },
  });
  const profile = await prisma.facultyProfile.create({
    data: {
      userId: user.id,
      approvalStatus: options.approvalStatus ?? 'PENDING',
      isPublished: options.isPublished ?? false,
      isActive: options.isActive ?? true,
      ...(options.createdAt && { createdAt: options.createdAt }),
    },
  });
  for (const curriculumId of options.curriculumIds ?? []) {
    await prisma.facultyAssignment.create({
      data: { facultyId: profile.id, curriculumId, isActive: options.assignmentActive ?? true },
    });
  }
  for (const q of options.qualifications ?? []) {
    await prisma.facultyQualification.create({
      data: { facultyId: profile.id, fieldOfStudy: 'Science', ...q },
    });
  }
  for (let i = 0; i < (options.documents ?? 0); i += 1) {
    await prisma.facultyDocument.create({
      data: {
        facultyId: profile.id,
        documentType: 'OTHER',
        originalFileName: `doc-${i}.pdf`,
        fileSize: 1024,
        mimeType: 'application/pdf',
        storageKey: `test/${randomUUID()}`,
      },
    });
  }
  return { ...profile, user };
}
