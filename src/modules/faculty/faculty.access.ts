import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { getEmailProvider } from '@infrastructure/email/index';
import { config } from '@config/index';
import { ForbiddenError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { describeOfferings } from '@modules/category-tree/index';
import { toPriceAmounts, type PriceAmounts } from '@modules/pricing/index';
import { accountReadyEmail } from './faculty.emails.js';

/**
 * Whether a tutor may use the faculty portal (decided 2026-11-04):
 * 1. an admin approved the application (screen 27b), and
 * 2. every subject the tutor chose at onboarding has an active tutor price (screen 29).
 * Until then the faculty login refuses with a code saying why. After signing in, the tutor
 * accepts or declines the prices (consent screen); a price change asks again.
 */

export type FacultyAccessState =
  | 'NO_PROFILE'
  | 'SUSPENDED'
  | 'REJECTED'
  | 'PENDING_REVIEW'
  | 'PENDING_PRICING'
  | 'READY';

export type ConsentStatus = 'required' | 'accepted' | 'rejected';

/** Shown on the roster and in the drawer. `none` until the application is approved. */
export type PricingStatus =
  | 'none'
  | 'awaiting_price'
  | 'awaiting_consent'
  | 'accepted'
  | 'declined';

export interface PricedSubject {
  assignmentId: string;
  curriculumId: string;
  subject: string;
  /** "Academic › School › K-12 › CBSE › Class 11" */
  pathLabel: string;
  price: (PriceAmounts & { ruleId: string; revision: number }) | null;
}

type Db = Prisma.TransactionClient | typeof prisma;

const ACTIVE_RULE_AT = (now: Date): Prisma.PriceRuleWhereInput => ({
  isActive: true,
  effectiveFrom: { lte: now },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
});

/** Each active subject of the tutors with its current tutor price (or null). */
export async function pricedSubjects(
  facultyIds: readonly string[],
  db: Db = prisma
): Promise<Map<string, PricedSubject[]>> {
  const result = new Map<string, PricedSubject[]>(facultyIds.map((id) => [id, []]));
  if (!facultyIds.length) return result;
  const now = new Date();
  const [assignments, rules] = await Promise.all([
    db.facultyAssignment.findMany({
      where: { facultyId: { in: [...facultyIds] }, isActive: true },
      select: { id: true, facultyId: true, curriculumId: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.priceRule.findMany({
      where: { facultyId: { in: [...facultyIds] }, ...ACTIVE_RULE_AT(now) },
      orderBy: { effectiveFrom: 'desc' },
    }),
  ]);
  const labels = new Map(
    (await describeOfferings(assignments.map((a) => a.curriculumId))).map((l) => [
      l.curriculumId,
      l,
    ])
  );
  for (const a of assignments) {
    const rule = rules.find(
      (r) => r.facultyId === a.facultyId && r.curriculumId === a.curriculumId
    );
    const label = labels.get(a.curriculumId);
    result.get(a.facultyId)?.push({
      assignmentId: a.id,
      curriculumId: a.curriculumId,
      subject: label?.subject ?? 'Unknown subject',
      pathLabel: label?.pathLabel ?? '',
      price: rule ? { ...toPriceAmounts(rule), ruleId: rule.id, revision: rule.revision } : null,
    });
  }
  return result;
}

/** Identifies the exact set of prices shown, so a consent applies to them only. */
export function priceSnapshotHash(subjects: readonly PricedSubject[]): string {
  const canonical = [...subjects]
    .map((s) => [
      s.curriculumId,
      s.price?.ruleId ?? '',
      s.price?.revision ?? 0,
      s.price?.sessionPricePaise ?? 0,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

interface ProfileForAccess {
  id: string;
  isActive: boolean;
  approvalStatus: string;
  user: { isActive: boolean; status: string };
}

/** Pure decision; exported for tests. */
export function decideAccess(
  profile: ProfileForAccess | null,
  subjects: readonly PricedSubject[]
): FacultyAccessState {
  if (!profile) return 'NO_PROFILE';
  if (
    !profile.isActive ||
    !profile.user.isActive ||
    ['SUSPENDED', 'INACTIVE'].includes(profile.user.status)
  ) {
    return 'SUSPENDED';
  }
  if (profile.approvalStatus === 'REJECTED') return 'REJECTED';
  if (profile.approvalStatus !== 'APPROVED') return 'PENDING_REVIEW';
  if (!subjects.length || subjects.some((s) => !s.price)) return 'PENDING_PRICING';
  return 'READY';
}

export async function consentStatuses(
  facultyIds: readonly string[],
  hashes: Map<string, string>,
  db: Db = prisma
): Promise<Map<string, { status: ConsentStatus; decidedAt: Date | null }>> {
  const rows = facultyIds.length
    ? await db.facultyPriceConsent.findMany({
        where: { facultyId: { in: [...facultyIds] } },
        orderBy: { decidedAt: 'desc' },
        select: { facultyId: true, snapshotHash: true, decision: true, decidedAt: true },
      })
    : [];
  const result = new Map<string, { status: ConsentStatus; decidedAt: Date | null }>();
  for (const id of facultyIds) {
    const latest = rows.find((r) => r.facultyId === id && r.snapshotHash === hashes.get(id));
    result.set(
      id,
      latest
        ? {
            status: latest.decision === 'ACCEPTED' ? 'accepted' : 'rejected',
            decidedAt: latest.decidedAt,
          }
        : { status: 'required', decidedAt: null }
    );
  }
  return result;
}

export interface FacultyAccess {
  state: FacultyAccessState;
  facultyId: string | null;
  subjects: PricedSubject[];
  snapshotHash: string | null;
  consent: ConsentStatus | null;
  consentDecidedAt: Date | null;
}

export async function getFacultyAccess(
  by: { userId: string } | { facultyId: string },
  db: Db = prisma
): Promise<FacultyAccess> {
  const profile = await db.facultyProfile.findUnique({
    where: 'userId' in by ? { userId: by.userId } : { id: by.facultyId },
    select: {
      id: true,
      isActive: true,
      approvalStatus: true,
      user: { select: { isActive: true, status: true } },
    },
  });
  if (!profile) {
    return {
      state: 'NO_PROFILE',
      facultyId: null,
      subjects: [],
      snapshotHash: null,
      consent: null,
      consentDecidedAt: null,
    };
  }
  const subjects = (await pricedSubjects([profile.id], db)).get(profile.id) ?? [];
  const state = decideAccess(profile, subjects);
  if (state !== 'READY') {
    return {
      state,
      facultyId: profile.id,
      subjects,
      snapshotHash: null,
      consent: null,
      consentDecidedAt: null,
    };
  }
  const hash = priceSnapshotHash(subjects);
  const consent = (await consentStatuses([profile.id], new Map([[profile.id, hash]]), db)).get(
    profile.id
  );
  return {
    state,
    facultyId: profile.id,
    subjects,
    snapshotHash: hash,
    consent: consent?.status ?? 'required',
    consentDecidedAt: consent?.decidedAt ?? null,
  };
}

export function pricingStatusOf(access: Pick<FacultyAccess, 'state' | 'consent'>): PricingStatus {
  if (access.state === 'PENDING_PRICING') return 'awaiting_price';
  if (access.state !== 'READY') return 'none';
  return access.consent === 'accepted'
    ? 'accepted'
    : access.consent === 'rejected'
      ? 'declined'
      : 'awaiting_consent';
}

const SIGN_IN_REFUSALS: Partial<Record<FacultyAccessState, { code: string; message: string }>> = {
  PENDING_REVIEW: {
    code: 'FACULTY_PENDING_REVIEW',
    message: 'Your application is under review. We will email you when it is approved.',
  },
  PENDING_PRICING: {
    code: 'FACULTY_PENDING_PRICING',
    message:
      'Your profile is approved. We are setting your session prices and will email you when you can sign in.',
  },
  REJECTED: {
    code: 'FACULTY_REJECTED',
    message: 'Your application was not approved. Check your email for details.',
  },
  SUSPENDED: {
    code: 'FACULTY_SUSPENDED',
    message: 'Your tutor account is inactive. Contact Amentorz support.',
  },
};

/**
 * Called by the faculty login after the password and role checks. Throws 403 with a code when
 * the tutor may not sign in yet; otherwise says whether the price consent is still needed.
 * A faculty user without a profile (development seeds) is let through unchanged.
 */
export async function assertFacultyCanSignIn(
  userId: string
): Promise<{ requiresPriceConsent: boolean }> {
  const access = await getFacultyAccess({ userId });
  const refusal = SIGN_IN_REFUSALS[access.state];
  if (refusal) throw new ForbiddenError(refusal.message, { code: refusal.code, severity: 'info' });
  return { requiresPriceConsent: access.state === 'READY' && access.consent !== 'accepted' };
}

/**
 * Called after a tutor price is created or changed (pricing module). The first time the
 * tutor becomes ready, records it and emails "you can sign in".
 */
export async function onTutorPricesChanged(facultyId: string): Promise<void> {
  try {
    const access = await getFacultyAccess({ facultyId });
    if (access.state !== 'READY') return;
    const marked = await prisma.facultyProfile.updateMany({
      where: { id: facultyId, accessReadyAt: null },
      data: { accessReadyAt: new Date() },
    });
    if (marked.count !== 1) return;
    const profile = await prisma.facultyProfile.findUniqueOrThrow({
      where: { id: facultyId },
      select: { user: { select: { email: true, fullName: true } } },
    });
    logger.info({ type: 'faculty', facultyId }, 'Tutor approved and fully priced; sign-in allowed');
    await getEmailProvider().send(
      accountReadyEmail({
        to: profile.user.email,
        fullName: profile.user.fullName,
        loginUrl: `${config.facultyAppUrl}/login`,
      })
    );
  } catch (err) {
    logger.warn(
      { err: { message: (err as Error).message }, facultyId },
      'Tutor readiness update failed'
    );
  }
}
