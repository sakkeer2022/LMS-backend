import { prisma } from '@infrastructure/database/index';
import { describeOfferings } from '@modules/category-tree/index';
import { toPriceAmounts, type PriceAmounts } from './pricing.engine.js';

/**
 * Screen 29, LMS-40: approved tutors' subjects that still need a tutor price. Each entry is one
 * subject card from the tutor's onboarding; setting its price (POST /admin/prices with the
 * tutor's facultyId) removes it here. The tutor can sign in once all their entries are priced.
 */

export interface AwaitingPrice {
  facultyId: string;
  facultyName: string;
  facultyEmail: string;
  approvedAt: Date | null;
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

const activeAt = (now: Date) => ({
  isActive: true,
  effectiveFrom: { lte: now },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
});

export async function listAwaitingPrices(): Promise<AwaitingPrice[]> {
  const now = new Date();
  const assignments = await prisma.facultyAssignment.findMany({
    where: {
      isActive: true,
      faculty: {
        approvalStatus: 'APPROVED',
        isActive: true,
        user: { isActive: true, deletedAt: null, status: { notIn: ['SUSPENDED', 'INACTIVE'] } },
      },
    },
    select: {
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
