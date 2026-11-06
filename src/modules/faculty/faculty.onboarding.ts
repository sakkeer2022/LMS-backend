import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { getStorage } from '@infrastructure/storage/index';
import { getEmailProvider } from '@infrastructure/email/index';
import { ConflictError, ValidationError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { logAction, type AuditContext } from '@modules/audit/audit.service.js';
import { countryFromMobile, isValidMobile } from '@modules/regions/index';
import {
  describeOfferings,
  getOfferingTree,
  type OfferingTree,
} from '@modules/category-tree/index';
import { hashInviteToken } from './faculty.tokens.js';
import {
  ONBOARDING_DOCUMENTS,
  checkDocument,
  documentStorageKey,
  type OnboardingDocumentField,
} from './faculty.documents.js';
import type { OnboardingApplicationInput } from './faculty.onboarding.dto.js';
import { applicationReceivedEmail } from './faculty.emails.js';

/**
 * Faculty onboarding from the invitation link (LMS-39, screens 43b-43e). The page validates
 * the link, collects the three steps in the browser, and submits once. The submit is atomic:
 * the invitation is consumed, and the user (faculty role), profile, subject assignments and
 * documents are created together, or nothing is. Files are stored first and removed again if
 * the transaction fails. The account cannot sign in until an admin approves it and prices
 * every subject (see faculty.access.ts).
 */

const BCRYPT_ROUNDS = 12;

/** Every unusable link gives the same answer, so a link reveals nothing about others. */
function invalidInvitation(): ValidationError {
  return new ValidationError(
    'This invitation link is invalid or has expired. Ask Amentorz for a new invitation.',
    {
      code: 'INVITATION_INVALID',
    }
  );
}

async function findUsableInvitation(
  token: string
): Promise<{ id: string; email: string; expiresAt: Date }> {
  const invitation = await prisma.facultyInvitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: { id: true, email: true, status: true, expiresAt: true },
  });
  if (!invitation || invitation.status !== 'PENDING' || invitation.expiresAt <= new Date()) {
    throw invalidInvitation();
  }
  return invitation;
}

export interface OnboardingSession {
  email: string;
  expiresAt: Date;
}

/** POST /faculty/onboarding/session: is this link usable, and for which email. */
export async function startOnboarding(token: string): Promise<OnboardingSession> {
  const invitation = await findUsableInvitation(token);
  return { email: invitation.email, expiresAt: invitation.expiresAt };
}

/** GET /faculty/onboarding/catalogue: the column picker's tree (public catalogue data). */
export function onboardingCatalogue(): Promise<OfferingTree> {
  return getOfferingTree();
}

export type UploadedFiles = Partial<Record<OnboardingDocumentField, Express.Multer.File[]>>;

export interface ApplicationResult {
  applicationReference: string;
  fullName: string;
  email: string;
  submittedAt: Date;
}

function fieldError(field: string, message: string, code = 'VALIDATION_ERROR'): ValidationError {
  return new ValidationError(message, { code, fieldErrors: { [field]: [message] } });
}

export async function submitApplication(
  dto: OnboardingApplicationInput,
  files: UploadedFiles,
  audit: AuditContext
): Promise<ApplicationResult> {
  const invitation = await findUsableInvitation(dto.token);

  // ── Validate everything before writing anything ──
  if (!(await isValidMobile(dto.mobileNumber))) {
    throw fieldError('mobileNumber', 'Enter a valid mobile number for a supported country');
  }
  const country = await countryFromMobile(dto.mobileNumber);

  const offerings = await describeOfferings(dto.curriculumIds);
  if (offerings.length !== dto.curriculumIds.length || offerings.some((o) => !o.selectable)) {
    throw fieldError(
      'curriculumIds',
      'One of the chosen subjects is no longer offered. Pick your subjects again.'
    );
  }

  const documents: {
    field: OnboardingDocumentField;
    type: (typeof ONBOARDING_DOCUMENTS)[number]['type'];
    file: Express.Multer.File;
    mime: string;
    fileName: string;
  }[] = [];
  const fileErrors: Record<string, string[]> = {};
  for (const spec of ONBOARDING_DOCUMENTS) {
    const uploaded = files[spec.field]?.[0];
    if (!uploaded) {
      fileErrors[spec.field] = [`Upload your ${spec.label.toLowerCase()}`];
      continue;
    }
    const check = await checkDocument(uploaded);
    if (!check.ok) fileErrors[spec.field] = [check.reason];
    else
      documents.push({
        field: spec.field,
        type: spec.type,
        file: uploaded,
        mime: check.mime,
        fileName: check.fileName,
      });
  }
  if (Object.keys(fileErrors).length) {
    throw new ValidationError('Check the highlighted documents', {
      code: 'DOCUMENT_INVALID',
      fieldErrors: fileErrors,
    });
  }

  const facultyRole = await prisma.role.findUnique({
    where: { name: 'faculty' },
    select: { id: true },
  });
  if (!facultyRole) throw new Error('The faculty role is not seeded');

  const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

  // ── Store files, then write everything in one transaction ──
  const storage = getStorage();
  const stored: string[] = [];
  try {
    for (const doc of documents) {
      const key = documentStorageKey();
      await storage.put(key, doc.file.buffer, doc.mime);
      stored.push(key);
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const consumed = await tx.facultyInvitation.updateMany({
        where: { id: invitation.id, status: 'PENDING', expiresAt: { gt: now } },
        data: { status: 'ACCEPTED', acceptedAt: now },
      });
      if (consumed.count !== 1) throw invalidInvitation();

      const existing = await tx.user.findFirst({
        where: { email: { equals: invitation.email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError('An account with this email already exists. Sign in instead.', {
          code: 'ALREADY_REGISTERED',
        });
      }

      const [{ seq }] = await tx.$queryRaw<
        { seq: bigint }[]
      >`SELECT nextval('faculty_application_reference_seq') AS seq`;
      const applicationReference = `AMZ-T-${seq.toString()}`;

      const user = await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash,
          fullName: dto.fullName,
          mobileNumber: dto.mobileNumber,
          timezone: country?.defaultTimezone ?? null,
          status: 'ACTIVE',
          // The invitation link was delivered to this address
          emailVerifiedAt: now,
          roles: { create: { roleId: facultyRole.id } },
        },
        select: { id: true },
      });
      const profile = await tx.facultyProfile.create({
        data: {
          userId: user.id,
          invitationId: invitation.id,
          approvalStatus: 'PENDING',
          city: dto.city,
          highestQualification: dto.highestQualification,
          studiedAt: dto.studiedAt,
          teachingExperience: dto.teachingExperience,
          offersOfflineClasses: dto.offersOfflineClasses,
          applicationReference,
          submittedAt: now,
          declarationAcceptedAt: now,
          primarySubject: offerings[0]?.subject ?? null,
        },
        select: { id: true },
      });
      await tx.facultyAssignment.createMany({
        data: dto.curriculumIds.map((curriculumId) => ({ facultyId: profile.id, curriculumId })),
      });
      await tx.facultyDocument.createMany({
        data: documents.map((doc, i) => ({
          facultyId: profile.id,
          documentType: doc.type,
          originalFileName: doc.fileName,
          fileSize: doc.file.size,
          mimeType: doc.mime,
          storageKey: stored[i] as string,
          // No malware scanner exists yet (see docs/PENDING_DECISIONS.md, F4)
          scanStatus: 'PENDING',
        })),
      });
      return { userId: user.id, facultyId: profile.id, applicationReference };
    });

    logger.info(
      {
        type: 'faculty',
        facultyId: result.facultyId,
        invitationId: invitation.id,
        subjects: dto.curriculumIds.length,
      },
      'Faculty application submitted'
    );
    try {
      await logAction({
        ...audit,
        actorId: result.userId,
        severity: 'INFO',
        entity: 'faculty_profile',
        action: 'faculty.application_submitted',
        resourceId: result.facultyId,
        newValue: {
          invitationId: invitation.id,
          applicationReference: result.applicationReference,
          curriculumIds: dto.curriculumIds,
          documents: documents.map((d) => d.type),
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to audit the faculty application');
    }
    void getEmailProvider()
      .send(
        applicationReceivedEmail({
          to: invitation.email,
          fullName: dto.fullName,
          reference: result.applicationReference,
        })
      )
      .catch((err: unknown) =>
        logger.warn(
          { err: { message: (err as Error).message }, facultyId: result.facultyId },
          'Application email failed'
        )
      );

    return {
      applicationReference: result.applicationReference,
      fullName: dto.fullName,
      email: invitation.email,
      submittedAt: now,
    };
  } catch (err) {
    await Promise.all(stored.map((key) => storage.delete(key).catch(() => undefined)));
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('An account with this email already exists. Sign in instead.', {
        code: 'ALREADY_REGISTERED',
      });
    }
    throw err;
  }
}
