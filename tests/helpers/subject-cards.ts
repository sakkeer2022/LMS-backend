import { randomUUID } from 'crypto';
import { prisma } from '@infrastructure/database/index';
import { createTreeNode, leafCurriculum } from './category-tree.js';
import { loginWithRole, type LoggedInUser } from './users.js';

/**
 * Subject card fixtures (decided 2026-11-12), written straight to the database: a branch with
 * `count` selectable leaf offerings, and a signed-in tutor with approved, priced cards.
 */

export async function createOfferings(
  count: number
): Promise<{ id: string; categoryId: string }[]> {
  const root = await createTreeNode(null, {
    code: `cards-${randomUUID().slice(0, 6)}`,
    name: 'Academic',
  });
  const branch = await createTreeNode(root, { name: 'Physics' });
  const offerings = [];
  for (let i = 1; i <= count; i += 1) {
    const leaf = await createTreeNode(branch, { name: `Class ${i}`, displayOrder: i });
    offerings.push(await leafCurriculum(leaf.id));
  }
  return offerings;
}

/** An active tutor price for one card (amounts as the engine stores them for 18% GST). */
export async function priceTutorCard(
  facultyId: string,
  curriculumId: string,
  sessionPricePaise = 100000
) {
  const gstPaise = Math.floor((sessionPricePaise * 1800 + 5000) / 10000);
  return prisma.priceRule.create({
    data: {
      curriculumId,
      facultyId,
      sessionPricePaise,
      gstPaise,
      studentPaysPaise: sessionPricePaise + gstPaise,
    },
  });
}

export interface Tutor extends LoggedInUser {
  facultyId: string;
}

/**
 * A tutor signed in to the faculty portal with a profile in the given state and approved cards
 * for `curriculumIds` (priced unless `priced` is false). Signs in before the profile exists, so
 * the sign-in gate never blocks the fixture.
 */
export async function signedInTutor(
  email: string,
  curriculumIds: string[],
  options: { approvalStatus?: 'PENDING' | 'APPROVED'; priced?: boolean } = {}
): Promise<Tutor> {
  const login = await loginWithRole('faculty', email);
  const profile = await prisma.facultyProfile.create({
    data: {
      userId: login.userId,
      approvalStatus: options.approvalStatus ?? 'APPROVED',
      approvedAt: options.approvalStatus === 'PENDING' ? null : new Date(),
    },
  });
  for (const curriculumId of curriculumIds) {
    await prisma.facultyAssignment.create({
      data: {
        facultyId: profile.id,
        curriculumId,
        status: options.approvalStatus === 'PENDING' ? 'PENDING' : 'APPROVED',
      },
    });
    if (options.priced !== false) await priceTutorCard(profile.id, curriculumId);
  }
  return { ...login, facultyId: profile.id };
}
