import type { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { getEmailProvider } from '@infrastructure/email/index';
import { config } from '@config/index';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { logAction, type AuditContext } from '@modules/audit/audit.service.js';
import { describeOfferings } from '@modules/category-tree/index';
import {
  getFacultyAccess,
  onTutorPricesChanged,
  type PricedSubject,
  type SubjectCardState,
} from './faculty.access.js';
import { subjectCardApprovedEmail, subjectCardRejectedEmail } from './faculty.emails.js';
import {
  MAX_SUBJECT_CARDS,
  SLOT_HOLDING_STATUSES,
  SUBJECT_CARD_LIMIT_MESSAGE,
  remainingSlots,
  usedSlots,
} from './faculty.subject-cards.rules.js';
import type { ReviewSubjectCardInput } from './faculty.subject-cards.dto.js';

/**
 * Subject cards after onboarding (decided 2026-11-12, Workflow C):
 *   tutor requests a card from the profile (same column picker as onboarding) → PENDING
 *   → admin sets the tutor price on the pricing page → admin approves (needs the price) → APPROVED
 *   → the tutor accepts the new price (consent) and the card opens in the library.
 * A rejected card frees its slot; a pending request can be cancelled by the tutor. At most
 * MAX_SUBJECT_CARDS PENDING or APPROVED cards per tutor: checked here under a lock on the profile
 * row, and by the faculty_assignments_limit trigger for every other write path.
 */

export interface SubjectCardView {
  id: string;
  curriculumId: string;
  subject: string;
  pathLabel: string;
  status: SubjectCardState;
  source: 'onboarding' | 'profile';
  requestedAt: Date;
  decidedAt: Date | null;
  /** The admin's reason, for a rejected card */
  decisionReason: string | null;
  /** An active tutor price exists */
  priced: boolean;
  /** Library resources may be added and edited under this card */
  libraryEnabled: boolean;
}

export interface MySubjectCards {
  limit: number;
  /** Cards holding a slot (pending or approved) */
  used: number;
  remaining: number;
  /** False when the limit is reached or the tutor is not approved and active */
  canRequest: boolean;
  cards: SubjectCardView[];
}

type Db = Prisma.TransactionClient | typeof prisma;

const LIMIT_TRIGGER = /subject_cards:LIMIT_REACHED/;

function limitError(): ConflictError {
  return new ConflictError(`${SUBJECT_CARD_LIMIT_MESSAGE}. Remove a pending request first.`, {
    code: 'SUBJECT_CARD_LIMIT',
  });
}

/** The trigger's limit error (any write path) as a 409; other errors unchanged. */
export function toSubjectCardError(err: unknown): unknown {
  let current: unknown = err;
  for (let i = 0; current && i < 5; i += 1) {
    if (current instanceof Error && LIMIT_TRIGGER.test(current.message)) return limitError();
    if (current && typeof current === 'object' && 'meta' in current) {
      if (LIMIT_TRIGGER.test(JSON.stringify((current as { meta: unknown }).meta))) {
        return limitError();
      }
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return err;
}

interface OwnProfile {
  id: string;
  isActive: boolean;
  approvalStatus: string;
  user: { isActive: boolean; status: string; email: string; fullName: string };
}

async function profileOf(userId: string, db: Db = prisma): Promise<OwnProfile> {
  const profile = await db.facultyProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      isActive: true,
      approvalStatus: true,
      user: { select: { isActive: true, status: true, email: true, fullName: true } },
    },
  });
  if (!profile) throw new NotFoundError('Faculty profile');
  return profile;
}

/** Approved, not suspended: may use and request cards. */
function canUseCards(profile: OwnProfile): boolean {
  return (
    profile.approvalStatus === 'APPROVED' &&
    profile.isActive &&
    profile.user.isActive &&
    !['SUSPENDED', 'INACTIVE'].includes(profile.user.status)
  );
}

function toView(card: PricedSubject, libraryEnabled: boolean): SubjectCardView {
  return {
    id: card.assignmentId,
    curriculumId: card.curriculumId,
    subject: card.subject,
    pathLabel: card.pathLabel,
    status: card.status,
    source: card.source,
    requestedAt: card.requestedAt,
    decidedAt: card.decidedAt,
    decisionReason: card.status === 'rejected' ? card.decisionReason : null,
    priced: Boolean(card.price),
    libraryEnabled,
  };
}

/** GET /faculty/me/subject-cards: the profile's Subject Cards section and the library's cards. */
export async function listMySubjectCards(userId: string): Promise<MySubjectCards> {
  const profile = await profileOf(userId);
  const access = await getFacultyAccess({ facultyId: profile.id });
  const selectable = new Set(
    (await describeOfferings(access.cards.map((c) => c.curriculumId)))
      .filter((o) => o.selectable)
      .map((o) => o.curriculumId)
  );
  const ready = access.state === 'READY';
  const counted = access.cards.map((c) => ({ isActive: true, status: c.status.toUpperCase() }));
  const remaining = remainingSlots(counted);
  return {
    limit: MAX_SUBJECT_CARDS,
    used: usedSlots(counted),
    remaining,
    canRequest: canUseCards(profile) && remaining > 0,
    cards: access.cards.map((c) =>
      toView(
        c,
        ready && c.status === 'approved' && Boolean(c.price) && selectable.has(c.curriculumId)
      )
    ),
  };
}

/**
 * The tutor's approved, active card for an offering, for the library. Throws 403
 * SUBJECT_CARD_NOT_ACTIVE when the card is missing, pending, rejected or its offering was switched
 * off, or when the tutor may not use the portal.
 */
export async function requireActiveSubjectCard(
  userId: string,
  curriculumId: string
): Promise<{ facultyId: string; assignmentId: string }> {
  const profile = await profileOf(userId);
  const access = await getFacultyAccess({ facultyId: profile.id });
  const card = access.subjects.find((c) => c.curriculumId === curriculumId);
  const [offering] = card ? await describeOfferings([curriculumId]) : [];
  if (access.state !== 'READY' || !card || !card.price || !offering?.selectable) {
    throw new ForbiddenError(
      'This subject card is not active. Resources can be managed once the card is approved.',
      { code: 'SUBJECT_CARD_NOT_ACTIVE' }
    );
  }
  return { facultyId: profile.id, assignmentId: card.assignmentId };
}

/** The tutor's own faculty profile id (404 without one). */
export async function facultyIdOfUser(userId: string): Promise<string> {
  return (await profileOf(userId)).id;
}

/** POST /faculty/me/subject-cards: request one more card (PENDING until the admin approves). */
export async function requestSubjectCard(
  userId: string,
  curriculumId: string,
  audit: AuditContext
): Promise<MySubjectCards> {
  const profile = await profileOf(userId);
  if (!canUseCards(profile)) {
    throw new ForbiddenError('You can add subject cards once your profile is approved', {
      code: 'FACULTY_NOT_APPROVED',
    });
  }
  const [offering] = await describeOfferings([curriculumId]);
  if (!offering?.selectable) {
    throw new ValidationError('This subject is not offered. Pick another one.', {
      code: 'VALIDATION_ERROR',
      fieldErrors: { curriculumId: ['This subject is not offered. Pick another one.'] },
    });
  }

  const now = new Date();
  let cardId: string;
  try {
    cardId = await prisma.$transaction(async (tx) => {
      // One request at a time per tutor (the trigger takes the same lock)
      await tx.$queryRaw`SELECT 1 FROM faculty_profiles WHERE id = ${profile.id}::uuid FOR NO KEY UPDATE`;
      const cards = await tx.facultyAssignment.findMany({
        where: { facultyId: profile.id },
        select: { id: true, curriculumId: true, isActive: true, status: true },
      });
      const existing = cards.find((c) => c.curriculumId === curriculumId);
      if (
        existing?.isActive &&
        (SLOT_HOLDING_STATUSES as readonly string[]).includes(existing.status)
      ) {
        throw new ConflictError('You already have this subject card', {
          code: 'SUBJECT_CARD_EXISTS',
        });
      }
      if (remainingSlots(cards) === 0) throw limitError();
      const data = {
        isActive: true,
        status: 'PENDING' as const,
        source: 'PROFILE' as const,
        requestedAt: now,
        decidedAt: null,
        decidedById: null,
        decisionReason: null,
      };
      // A rejected or switched-off card is asked for again on the same row (unique per offering)
      const row = existing
        ? await tx.facultyAssignment.update({
            where: { id: existing.id },
            data,
            select: { id: true },
          })
        : await tx.facultyAssignment.create({
            data: { ...data, facultyId: profile.id, curriculumId },
            select: { id: true },
          });
      return row.id;
    });
  } catch (err) {
    throw toSubjectCardError(err);
  }

  logger.info({ type: 'faculty', facultyId: profile.id, cardId }, 'Subject card requested');
  await audited(audit, userId, 'faculty.subject_card_requested', cardId, {
    facultyId: profile.id,
    curriculumId,
    subject: offering.subject,
    pathLabel: offering.pathLabel,
  });
  return listMySubjectCards(userId);
}

/** DELETE /faculty/me/subject-cards/:cardId: cancel a pending request (frees the slot). */
export async function cancelSubjectCard(
  userId: string,
  cardId: string,
  audit: AuditContext
): Promise<MySubjectCards> {
  const profile = await profileOf(userId);
  const removed = await prisma.facultyAssignment.deleteMany({
    where: { id: cardId, facultyId: profile.id, status: 'PENDING', source: 'PROFILE' },
  });
  if (removed.count !== 1) {
    const card = await prisma.facultyAssignment.findFirst({
      where: { id: cardId, facultyId: profile.id },
      select: { id: true },
    });
    if (!card) throw new NotFoundError('Subject card');
    throw new ConflictError('Only a pending request can be cancelled', {
      code: 'SUBJECT_CARD_NOT_PENDING',
    });
  }
  await audited(audit, userId, 'faculty.subject_card_cancelled', cardId, {
    facultyId: profile.id,
  });
  return listMySubjectCards(userId);
}

export interface ReviewedSubjectCard {
  id: string;
  facultyId: string;
  curriculumId: string;
  subject: string;
  pathLabel: string;
  status: SubjectCardState;
  decidedAt: Date | null;
  decisionReason: string | null;
}

/**
 * PUT /admin/faculty/:facultyId/subject-cards/:cardId/review: approve (needs an active tutor
 * price) or reject (needs a reason) a pending card. Approving changes the prices the tutor
 * accepted, so the tutor accepts again before using the portal (existing consent rule).
 */
export async function reviewSubjectCard(
  facultyId: string,
  cardId: string,
  input: ReviewSubjectCardInput,
  audit: AuditContext
): Promise<ReviewedSubjectCard> {
  const now = new Date();
  const card = await prisma.facultyAssignment.findFirst({
    where: { id: cardId, facultyId, isActive: true },
    select: {
      id: true,
      curriculumId: true,
      status: true,
      faculty: {
        select: { approvalStatus: true, user: { select: { email: true, fullName: true } } },
      },
    },
  });
  if (!card) throw new NotFoundError('Subject card');
  if (card.status !== 'PENDING') {
    throw new ConflictError(`This subject card was already ${card.status.toLowerCase()}`, {
      code: 'SUBJECT_CARD_ALREADY_DECIDED',
    });
  }
  if (input.decision === 'approve') {
    if (card.faculty.approvalStatus !== 'APPROVED') {
      throw new ConflictError('Approve the tutor’s application first', {
        code: 'FACULTY_NOT_APPROVED',
      });
    }
    const priced = await prisma.priceRule.count({
      where: {
        facultyId,
        curriculumId: card.curriculumId,
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
    });
    if (!priced) {
      throw new ConflictError('Set the tutor’s price for this subject before approving it', {
        code: 'SUBJECT_CARD_NOT_PRICED',
      });
    }
  }

  const status = input.decision === 'approve' ? 'APPROVED' : 'REJECTED';
  const changed = await prisma.facultyAssignment.updateMany({
    where: { id: cardId, status: 'PENDING' },
    data: {
      status,
      decidedAt: now,
      decidedById: audit.actorId ?? null,
      decisionReason: input.decision === 'reject' ? (input.reason ?? null) : null,
    },
  });
  if (changed.count !== 1) {
    throw new ConflictError('Someone else decided this subject card; reload and try again', {
      code: 'SUBJECT_CARD_ALREADY_DECIDED',
    });
  }

  const [label] = await describeOfferings([card.curriculumId]);
  const subject = label?.subject ?? 'Subject';
  const pathLabel = label?.pathLabel ?? '';
  logger.info({ type: 'faculty', facultyId, cardId, status }, 'Subject card reviewed');
  await audited(
    audit,
    audit.actorId ?? null,
    input.decision === 'approve'
      ? 'faculty.subject_card_approved'
      : 'faculty.subject_card_rejected',
    cardId,
    { facultyId, curriculumId: card.curriculumId, ...(input.reason && { reason: input.reason }) },
    'SECURITY'
  );

  const { email, fullName } = card.faculty.user;
  void getEmailProvider()
    .send(
      input.decision === 'approve'
        ? subjectCardApprovedEmail({
            to: email,
            fullName,
            subject,
            pathLabel,
            loginUrl: `${config.facultyAppUrl}/login`,
          })
        : subjectCardRejectedEmail({
            to: email,
            fullName,
            subject,
            pathLabel,
            reason: input.reason ?? '',
          })
    )
    .catch((err: unknown) =>
      logger.warn({ err: { message: (err as Error).message }, cardId }, 'Subject card email failed')
    );
  if (input.decision === 'approve') await onTutorPricesChanged(facultyId);

  return {
    id: cardId,
    facultyId,
    curriculumId: card.curriculumId,
    subject,
    pathLabel,
    status: status.toLowerCase() as SubjectCardState,
    decidedAt: now,
    decisionReason: input.decision === 'reject' ? (input.reason ?? null) : null,
  };
}

async function audited(
  audit: AuditContext,
  actorId: string | null,
  action: string,
  resourceId: string,
  newValue: Record<string, unknown>,
  severity: 'INFO' | 'SECURITY' = 'INFO'
): Promise<void> {
  try {
    await logAction({
      ...audit,
      actorId,
      severity,
      entity: 'faculty_assignment',
      action,
      resourceId,
      newValue,
    });
  } catch (err) {
    logger.error({ err, action }, 'Failed to audit a subject card change');
  }
}
