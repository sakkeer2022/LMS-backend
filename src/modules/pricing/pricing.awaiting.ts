import type { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { describeOfferings } from '@modules/category-tree/index';
import { toPriceAmounts, type PriceAmounts } from './pricing.engine.js';

/**
 * Screen 29, LMS-40: approved tutors' subject cards that still need a tutor price: the cards from
 * onboarding (approved with the application) and cards the tutor requested later from the profile
 * (cardStatus "pending": the admin prices them, then approves them from the row menu). Setting the
 * price (POST /admin/prices with the tutor's facultyId) removes the entry here. Rejected cards are
 * left out. The tutor can sign in once every approved card is priced.
 */

export interface AwaitingPrice {
  facultyId: string;
  facultyName: string;
  facultyEmail: string;
  approvedAt: Date | null;
  /** The subject card (faculty_assignments id) and its approval state */
  cardId: string;
  cardStatus: 'pending' | 'approved';
  curriculumId: string;
  subject: string;
  /** "Academic › School › K-12 › CBSE › Class 11" */
  pathLabel: string;
  categoryPath: string[];
  board: string | null;
  level: string | null;
  /** The offering's default (all-tutor) price, as a suggestion. */
  defaultPrice: PriceAmounts | null;
}

const activeAt = (now: Date): Prisma.PriceRuleWhereInput => ({
  isActive: true,
  effectiveFrom: { lte: now },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
});

export async function listAwaitingPrices(): Promise<AwaitingPrice[]> {
  const now = new Date();
  const assignments = await prisma.facultyAssignment.findMany({
    where: {
      isActive: true,
      status: { in: ['PENDING', 'APPROVED'] },
      faculty: {
        approvalStatus: 'APPROVED',
        isActive: true,
        user: { isActive: true, deletedAt: null, status: { notIn: ['SUSPENDED', 'INACTIVE'] } },
      },
    },
    select: {
      id: true,
      status: true,
      facultyId: true,
      curriculumId: true,
      faculty: { select: { approvedAt: true, user: { select: { fullName: true, email: true } } } },
    },
    orderBy: [{ faculty: { approvedAt: 'asc' } }, { createdAt: 'asc' }],
  });
  if (!assignments.length) return [];

  const facultyIds = [...new Set(assignments.map((a) => a.facultyId))];
  const curriculumIds = [...new Set(assignments.map((a) => a.curriculumId))];
  const [tutorRules, defaultRules, labels] = await Promise.all([
    prisma.priceRule.findMany({
      where: { facultyId: { in: facultyIds }, ...activeAt(now) },
      select: { facultyId: true, curriculumId: true },
    }),
    prisma.priceRule.findMany({
      where: { facultyId: null, curriculumId: { in: curriculumIds }, ...activeAt(now) },
      orderBy: { effectiveFrom: 'desc' },
    }),
    describeOfferings(curriculumIds),
  ]);
  const priced = new Set(tutorRules.map((r) => `${r.facultyId}:${r.curriculumId}`));
  const labelOf = new Map(labels.map((l) => [l.curriculumId, l]));

  return assignments
    .filter((a) => !priced.has(`${a.facultyId}:${a.curriculumId}`))
    .map((a) => {
      const label = labelOf.get(a.curriculumId);
      const fallback = defaultRules.find((r) => r.curriculumId === a.curriculumId);
      return {
        facultyId: a.facultyId,
        facultyName: a.faculty.user.fullName,
        facultyEmail: a.faculty.user.email,
        approvedAt: a.faculty.approvedAt,
        cardId: a.id,
        cardStatus: a.status === 'PENDING' ? 'pending' : 'approved',
        curriculumId: a.curriculumId,
        subject: label?.subject ?? 'Unknown subject',
        pathLabel: label?.pathLabel ?? '',
        categoryPath: label?.categoryPath ?? [],
        board: label?.board ?? null,
        level: label?.level ?? null,
        defaultPrice: fallback ? toPriceAmounts(fallback) : null,
      };
    });
}
