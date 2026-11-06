import { prisma } from '@infrastructure/database/index';
import { getEmailProvider } from '@infrastructure/email/index';
import { config } from '@config/index';
import { ConflictError, ForbiddenError, NotFoundError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { logAction, type AuditContext } from '@modules/audit/audit.service.js';
import { getFacultyAccess, type ConsentStatus, type PricedSubject } from './faculty.access.js';
import { priceDeclinedEmail } from './faculty.emails.js';
import type { PriceConsentDecisionInput } from './faculty.review.dto.js';

/**
 * Price consent (after the first sign-in). The tutor sees every subject with its session
 * price and accepts or declines that exact list. Declining keeps the portal blocked and tells
 * the admin who approved the tutor; a new price asks again. The screen design is not final.
 */

export interface PriceConsentView {
  status: ConsentStatus;
  decidedAt: Date | null;
  snapshotHash: string;
  subjects: (Omit<PricedSubject, 'price'> & { price: NonNullable<PricedSubject['price']> })[];
}

async function readyAccess(userId: string) {
  const access = await getFacultyAccess({ userId });
  if (access.state === 'NO_PROFILE') throw new NotFoundError('Faculty profile');
  if (access.state !== 'READY' || !access.snapshotHash || !access.facultyId) {
    throw new ForbiddenError('Your prices are not ready yet', { code: 'FACULTY_PENDING_PRICING' });
  }
  return access as typeof access & { snapshotHash: string; facultyId: string };
}

export async function getPriceConsent(userId: string): Promise<PriceConsentView> {
  const access = await readyAccess(userId);
  return {
    status: access.consent ?? 'required',
    decidedAt: access.consentDecidedAt,
    snapshotHash: access.snapshotHash,
    subjects: access.subjects.map((s) => ({
      ...s,
      price: s.price as NonNullable<PricedSubject['price']>,
    })),
  };
}

export async function decidePriceConsent(
  userId: string,
  input: PriceConsentDecisionInput,
  audit: AuditContext
): Promise<PriceConsentView> {
  const access = await readyAccess(userId);
  if (access.snapshotHash !== input.snapshotHash) {
    throw new ConflictError('Your prices changed while this page was open. Review them again.', {
      code: 'PRICES_CHANGED',
    });
  }
  const decision = input.decision === 'accept' ? 'ACCEPTED' : 'REJECTED';
  const snapshot = access.subjects.map((s) => ({
    curriculumId: s.curriculumId,
    subject: s.subject,
    pathLabel: s.pathLabel,
    ruleId: s.price?.ruleId,
    sessionPricePaise: s.price?.sessionPricePaise,
    gstPaise: s.price?.gstPaise,
    studentPaysPaise: s.price?.studentPaysPaise,
  }));
  const row = await prisma.facultyPriceConsent.create({
    data: {
      facultyId: access.facultyId,
      decision,
      snapshotHash: access.snapshotHash,
      priceSnapshot: snapshot,
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
    },
  });
  logger.info(
    { type: 'faculty', facultyId: access.facultyId, decision },
    'Tutor price consent recorded'
  );
  try {
    await logAction({
      ...audit,
      severity: 'INFO',
      entity: 'faculty_profile',
      action: decision === 'ACCEPTED' ? 'faculty.prices_accepted' : 'faculty.prices_declined',
      resourceId: access.facultyId,
      newValue: { snapshotHash: access.snapshotHash, subjects: snapshot },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to audit the price consent');
  }

  if (decision === 'REJECTED') void notifyAdminOfDecline(access.facultyId);

  return {
    status: decision === 'ACCEPTED' ? 'accepted' : 'rejected',
    decidedAt: row.decidedAt,
    snapshotHash: access.snapshotHash,
    subjects: access.subjects.map((s) => ({
      ...s,
      price: s.price as NonNullable<PricedSubject['price']>,
    })),
  };
}

/** Emails the admin who approved the tutor (or who invited them). */
async function notifyAdminOfDecline(facultyId: string): Promise<void> {
  try {
    const profile = await prisma.facultyProfile.findUniqueOrThrow({
      where: { id: facultyId },
      select: {
        user: { select: { email: true, fullName: true } },
        approver: { select: { email: true } },
        invitation: { select: { invitedBy: { select: { email: true } } } },
      },
    });
    const to = profile.approver?.email ?? profile.invitation?.invitedBy?.email;
    if (!to) return;
    await getEmailProvider().send(
      priceDeclinedEmail({
        to,
        tutorName: profile.user.fullName,
        tutorEmail: profile.user.email,
        adminUrl: `${config.appBaseUrl}/admin/pricing`,
      })
    );
  } catch (err) {
    logger.warn(
      { err: { message: (err as Error).message }, facultyId },
      'Price decline email failed'
    );
  }
}
