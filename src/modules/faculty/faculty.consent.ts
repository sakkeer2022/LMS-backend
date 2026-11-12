import { randomUUID } from 'node:crypto';
import { prisma } from '@infrastructure/database/index';
import { getEmailProvider } from '@infrastructure/email/index';
import { getStorage } from '@infrastructure/storage/index';
import { isPng } from '@infrastructure/pdf/index';
import { config } from '@config/index';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { logAction, type AuditContext } from '@modules/audit/audit.service.js';
import { getFacultyAccess, type ConsentStatus, type PricedSubject } from './faculty.access.js';
import { priceDeclinedEmail } from './faculty.emails.js';
import type { PriceConsentDecisionInput } from './faculty.review.dto.js';

/**
 * Price consent (after the first sign-in). The tutor sees every subject with its session
 * price and accepts or declines that exact list. Accepting is a formal agreement: the tutor
 * draws a signature (PNG, same pad as the guardian consent in the student app), stored in
 * private storage with the consent row. Declining keeps the portal blocked and tells the admin
 * who approved the tutor; a new price asks again.
 */

/** Server-generated storage key for a consent signature; never derived from input. */
export function signatureStorageKey(): string {
  return `faculty-consent-signatures/${randomUUID()}.png`;
}

/** The signature is required to accept and refused with a decline. Throws a field error otherwise. */
export function checkConsentSignature(
  decision: 'accept' | 'reject',
  signaturePng: Buffer | undefined
): void {
  if (decision === 'accept') {
    if (!signaturePng || !isPng(signaturePng)) {
      const message = 'Sign in the box to accept your prices';
      throw new ValidationError(message, {
        code: 'SIGNATURE_REQUIRED',
        fieldErrors: { signature: [message] },
      });
    }
    if (signaturePng.length > config.consent.signatureMaxBytes) {
      throw new ValidationError('The signature image is too large', {
        code: 'SIGNATURE_REQUIRED',
        fieldErrors: { signature: ['The signature image is too large'] },
      });
    }
  }
}

type ConsentSubject = Pick<
  PricedSubject,
  'assignmentId' | 'curriculumId' | 'subject' | 'pathLabel'
> & {
  price: NonNullable<PricedSubject['price']>;
};

export interface PriceConsentView {
  status: ConsentStatus;
  decidedAt: Date | null;
  snapshotHash: string;
  /** The approved subject cards; their prices are what the tutor accepts */
  subjects: ConsentSubject[];
}

function consentSubject(s: PricedSubject): ConsentSubject {
  return {
    assignmentId: s.assignmentId,
    curriculumId: s.curriculumId,
    subject: s.subject,
    pathLabel: s.pathLabel,
    price: s.price as NonNullable<PricedSubject['price']>,
  };
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
    subjects: access.subjects.map(consentSubject),
  };
}

export async function decidePriceConsent(
  userId: string,
  input: PriceConsentDecisionInput,
  audit: AuditContext,
  signaturePng?: Buffer
): Promise<PriceConsentView> {
  const access = await readyAccess(userId);
  if (access.snapshotHash !== input.snapshotHash) {
    throw new ConflictError('Your prices changed while this page was open. Review them again.', {
      code: 'PRICES_CHANGED',
    });
  }
  checkConsentSignature(input.decision, signaturePng);
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
  const storage = getStorage();
  const signatureKey = decision === 'ACCEPTED' && signaturePng ? signatureStorageKey() : null;
  if (signatureKey && signaturePng) await storage.put(signatureKey, signaturePng, 'image/png');
  let row;
  try {
    row = await prisma.facultyPriceConsent.create({
      data: {
        facultyId: access.facultyId,
        decision,
        snapshotHash: access.snapshotHash,
        priceSnapshot: snapshot,
        ipAddress: audit.ipAddress ?? null,
        userAgent: audit.userAgent ?? null,
        signatureStorageKey: signatureKey,
      },
    });
  } catch (err) {
    if (signatureKey) await storage.delete(signatureKey).catch(() => undefined);
    throw err;
  }
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
      newValue: {
        snapshotHash: access.snapshotHash,
        subjects: snapshot,
        signed: Boolean(signatureKey),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to audit the price consent');
  }

  if (decision === 'REJECTED') void notifyAdminOfDecline(access.facultyId);

  return {
    status: decision === 'ACCEPTED' ? 'accepted' : 'rejected',
    decidedAt: row.decidedAt,
    snapshotHash: access.snapshotHash,
    subjects: access.subjects.map(consentSubject),
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
