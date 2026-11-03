import crypto from 'node:crypto';
import type { GuardianConsent, PolicyDocument } from '@prisma/client';
import { config } from '@config/index';
import { prisma } from '@infrastructure/database/index.js';
import { getPdfService, isPng } from '@infrastructure/pdf/index.js';
import { getStorage, sha256Hex } from '@infrastructure/storage/index.js';
import { logger } from '@core/logger/index';
import { NotFoundError, ServiceUnavailableError, ValidationError } from '@core/errors/index';
import { guardianConsentAge } from '@modules/regions/index.js';
import { completedYears } from '@shared/dates';
import type { SignConsentInput } from './consent.dto.js';

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

export interface ConsentReceipt {
  consentToken: string;
  policyId: string;
  signedAt: Date;
  expiresAt: Date;
  signedPdfSha256: string;
}

export interface SigningContext {
  ipAddress: string;
  userAgent: string | null;
}

/**
 * Signs the Student Terms for a student under the country's consent age, before the account exists. The
 * country comes from the policy being signed (chosen by the client from the mobile number's dialling code),
 * so the age rule is always that country's. Returns a single-use consent token; only its hash is stored.
 */
export async function signGuardianConsent(
  input: SignConsentInput,
  signaturePng: Buffer | undefined,
  context: SigningContext
): Promise<ConsentReceipt> {
  const policy = await prisma.policyDocument.findUnique({ where: { id: input.policyId } });
  if (!policy || policy.type !== 'STUDENT_TERMS' || !policy.isCurrent) {
    throw new ValidationError('Sign the current Student Terms for your country.');
  }

  const consentAge = await guardianConsentAge(policy.country);
  const age = completedYears(input.studentDateOfBirth, new Date());
  if (age === null || age >= consentAge) {
    throw new ValidationError(
      'A guardian signature is only needed for a student below the required age.'
    );
  }

  if (input.signatureMode === 'draw') {
    if (!signaturePng || !isPng(signaturePng))
      throw new ValidationError('Draw your signature again.');
  } else if (signaturePng) {
    throw new ValidationError('A typed signature has no image.');
  }

  const base = await readPolicyBytes(policy);
  const now = new Date();
  const consentId = crypto.randomUUID();
  const stamped = await getPdfService().stampConsent({
    basePdf: base,
    ...(input.signatureMode === 'draw' ? { signaturePng } : { typedName: input.typedName }),
    studentFullName: input.studentFullName,
    signedAt: now,
    ipAddress: context.ipAddress,
    policySha256: policy.sha256,
  });
  const stored = await getStorage().put(`consents/${consentId}.pdf`, stamped, 'application/pdf');

  const consentToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + config.consent.unlinkedTtlHours * 3_600_000);
  try {
    await prisma.guardianConsent.create({
      data: {
        id: consentId,
        policyId: policy.id,
        tokenHash: sha256(consentToken),
        studentFullName: input.studentFullName,
        studentDateOfBirth: new Date(`${input.studentDateOfBirth}T00:00:00Z`),
        signatureMode: input.signatureMode === 'draw' ? 'DRAW' : 'TYPE',
        typedName: input.typedName ?? null,
        signedPdfStorageKey: stored.key,
        signedPdfSha256: stored.sha256,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        signedAt: now,
        expiresAt,
      },
    });
  } catch (error) {
    // No row, so nothing would ever clean the file up: remove it now
    await getStorage()
      .delete(stored.key)
      .catch(() => undefined);
    throw error;
  }
  return {
    consentToken,
    policyId: policy.id,
    signedAt: now,
    expiresAt,
    signedPdfSha256: stored.sha256,
  };
}

async function readPolicyBytes(policy: PolicyDocument): Promise<Buffer> {
  const bytes = await getStorage().get(policy.storageKey);
  if (!bytes || sha256Hex(bytes) !== policy.sha256) {
    logger.error(
      { policyId: policy.id },
      'policy file is missing or altered; consent cannot be signed'
    );
    throw new ServiceUnavailableError('The Student Terms are not available right now.');
  }
  return bytes;
}

export interface ConsentFile {
  bytes: Buffer;
  sha256: string;
}

/** Reads a signed consent PDF and checks it against the hash recorded when it was signed. */
async function readConsentFile(consent: GuardianConsent): Promise<ConsentFile> {
  const bytes = await getStorage().get(consent.signedPdfStorageKey);
  if (!bytes || sha256Hex(bytes) !== consent.signedPdfSha256) {
    logger.error({ consentId: consent.id }, 'signed consent file is missing or altered');
    throw new ServiceUnavailableError('The signed consent is not available right now.');
  }
  return { bytes, sha256: consent.signedPdfSha256 };
}

/**
 * The signed consent before registration, for whoever holds its token. Unknown, expired and already linked
 * tokens are all a 404. Reading does not use the token up.
 */
export async function getPendingConsentFile(token: string): Promise<ConsentFile> {
  const consent = await prisma.guardianConsent.findUnique({ where: { tokenHash: sha256(token) } });
  if (!consent || consent.linkedAt || consent.expiresAt <= new Date())
    throw new NotFoundError('Consent');
  return readConsentFile(consent);
}

/** The signed consent of the signed-in student (their own, linked at registration). */
export async function getOwnConsentFile(userId: string): Promise<ConsentFile> {
  const consent = await prisma.guardianConsent.findFirst({
    where: { student: { userId }, linkedAt: { not: null } },
    orderBy: { signedAt: 'desc' },
  });
  if (!consent) throw new NotFoundError('Consent');
  return readConsentFile(consent);
}

export interface ConsentSummary {
  id: string;
  policyId: string;
  policyTitle: string;
  policyVersion: string;
  country: string;
  signedAt: Date;
  linkedAt: Date;
  guardianName: string | null;
  guardianRelationship: string | null;
  signatureMode: 'draw' | 'type';
  signedPdfSha256: string;
}

async function linkedConsent(
  studentId: string
): Promise<GuardianConsent & { policy: PolicyDocument }> {
  const consent = await prisma.guardianConsent.findFirst({
    where: { studentId, linkedAt: { not: null } },
    include: { policy: true },
    orderBy: { signedAt: 'desc' },
  });
  if (!consent) throw new NotFoundError('Consent');
  return consent;
}

/** What an admin sees against an under-18 student: the record, not the file. */
export async function getConsentSummary(studentId: string): Promise<ConsentSummary> {
  const consent = await linkedConsent(studentId);
  return {
    id: consent.id,
    policyId: consent.policyId,
    policyTitle: consent.policy.title,
    policyVersion: consent.policy.version,
    country: consent.policy.country,
    signedAt: consent.signedAt,
    linkedAt: consent.linkedAt as Date,
    guardianName: consent.guardianName,
    guardianRelationship: consent.guardianRelationship?.toLowerCase() ?? null,
    signatureMode: consent.signatureMode === 'DRAW' ? 'draw' : 'type',
    signedPdfSha256: consent.signedPdfSha256,
  };
}

export async function getStudentConsentFile(
  studentId: string
): Promise<ConsentFile & { consentId: string }> {
  const consent = await linkedConsent(studentId);
  return { ...(await readConsentFile(consent)), consentId: consent.id };
}

/**
 * Deletes signed consents that were never linked to an account and have expired, with their PDFs. A row is
 * removed only if it is still unlinked and expired at the moment of deletion, so a consent being linked
 * right now survives; its file is removed only for rows that were really deleted.
 */
export async function purgeExpiredConsents(now: Date = new Date()): Promise<number> {
  const candidates = await prisma.guardianConsent.findMany({
    where: { linkedAt: null, expiresAt: { lt: now } },
    select: { id: true, signedPdfStorageKey: true },
    take: 500,
  });
  let purged = 0;
  for (const candidate of candidates) {
    const deleted = await prisma.guardianConsent.deleteMany({
      where: { id: candidate.id, linkedAt: null, expiresAt: { lt: now } },
    });
    if (deleted.count !== 1) continue;
    purged += 1;
    await getStorage()
      .delete(candidate.signedPdfStorageKey)
      .catch((error: unknown) =>
        logger.error(
          { err: error, key: candidate.signedPdfStorageKey },
          'could not delete a purged consent file'
        )
      );
  }
  if (purged > 0) logger.info({ purged }, 'purged expired guardian consents');
  return purged;
}
