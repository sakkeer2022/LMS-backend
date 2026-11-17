import { prisma } from '@infrastructure/database/index';
import { getStorage } from '@infrastructure/storage/index';
import { getEmailProvider } from '@infrastructure/email/index';
import { ValidationError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { logAction, type AuditContext } from '@modules/audit/audit.service.js';
import { isValidMobile } from '@modules/regions/index';
import { describeOfferings } from '@modules/category-tree/index';
import { hashInviteToken } from './faculty.tokens.js';
import {
  ADDITIONAL_DOCUMENTS,
  ONBOARDING_DOCUMENTS,
  REQUIRED_DOCUMENT_TYPES,
  documentStorageKey,
} from './faculty.documents.js';
import {
  checkUploadedDocuments,
  type ApplicationResult,
  type UploadedFiles,
} from './faculty.onboarding.js';
import { requireTeachingMode } from './faculty.teaching-modes.js';
import { reuploadReceivedEmail } from './faculty.emails.js';
import type { ReuploadApplicationInput } from './faculty.onboarding.dto.js';

/**
 * Re-upload after an admin's "Request re-upload" (temporary rejection). The emailed link opens the same
 * onboarding form with the tutor's answers and documents filled in. Submitting it consumes the link,
 * updates the profile and documents in one transaction, and puts the application back to PENDING ("New")
 * for the admin. A required document the tutor does not replace stays on file.
 */

const LABELS: Record<string, string> = {
  ...Object.fromEntries(ONBOARDING_DOCUMENTS.map((d) => [d.type, d.label])),
  [ADDITIONAL_DOCUMENTS.type]: ADDITIONAL_DOCUMENTS.label,
};

/** Every unusable link gives the same answer, so a link reveals nothing about others. */
function invalidLink(): ValidationError {
  return new ValidationError(
    'This link is invalid, already used or has expired. Ask Amentorz to send you a new one.',
    { code: 'REUPLOAD_LINK_INVALID' }
  );
}

interface UsableRequest {
  id: string;
  facultyId: string;
  reason: string;
  expiresAt: Date;
}

async function findUsableRequest(token: string): Promise<UsableRequest> {
  const request = await prisma.facultyReuploadRequest.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      id: true,
      facultyId: true,
      reason: true,
      status: true,
      expiresAt: true,
      faculty: { select: { approvalStatus: true, user: { select: { deletedAt: true } } } },
    },
  });
  if (
    !request ||
    request.status !== 'PENDING' ||
    request.expiresAt <= new Date() ||
    request.faculty.approvalStatus !== 'CHANGES_REQUESTED' ||
    request.faculty.user.deletedAt
  ) {
    throw invalidLink();
  }
  return request;
}

export interface ReuploadSession {
  email: string;
  expiresAt: Date;
  reason: string;
  applicationReference: string | null;
  values: {
    fullName: string;
    mobileNumber: string | null;
    city: string | null;
    highestQualification: string | null;
    teachingExperience: string | null;
    teachingMode: string | null;
    studiedAt: string | null;
  };
  curriculumIds: string[];
  documents: {
    id: string;
    type: string;
    label: string;
    fileName: string;
    fileSize: number;
    uploadedAt: Date;
    required: boolean;
  }[];
}

/** POST /faculty/onboarding/reupload/session: the pre-filled answers for a usable link. */
export async function startReupload(token: string): Promise<ReuploadSession> {
  const request = await findUsableRequest(token);
  const profile = await prisma.facultyProfile.findUniqueOrThrow({
    where: { id: request.facultyId },
    select: {
      applicationReference: true,
      city: true,
      highestQualification: true,
      teachingExperience: true,
      teachingMode: true,
      studiedAt: true,
      user: { select: { email: true, fullName: true, mobileNumber: true } },
      assignments: { where: { isActive: true }, select: { curriculumId: true } },
      documents: { orderBy: { createdAt: 'asc' } },
    },
  });
  return {
    email: profile.user.email,
    expiresAt: request.expiresAt,
    reason: request.reason,
    applicationReference: profile.applicationReference,
    values: {
      fullName: profile.user.fullName,
      mobileNumber: profile.user.mobileNumber,
      city: profile.city,
      highestQualification: profile.highestQualification,
      teachingExperience: profile.teachingExperience,
      teachingMode: profile.teachingMode,
      studiedAt: profile.studiedAt,
    },
    curriculumIds: profile.assignments.map((a) => a.curriculumId),
    documents: profile.documents.map((d) => ({
      id: d.id,
      type: d.documentType,
      label: LABELS[d.documentType] ?? 'Document',
      fileName: d.originalFileName,
      fileSize: d.fileSize,
      uploadedAt: d.createdAt,
      required: (REQUIRED_DOCUMENT_TYPES as readonly string[]).includes(d.documentType),
    })),
  };
}

function fieldError(field: string, message: string): ValidationError {
  return new ValidationError(message, { fieldErrors: { [field]: [message] } });
}

/** POST /faculty/onboarding/reupload: save the corrected application. */
export async function submitReupload(
  dto: ReuploadApplicationInput,
  files: UploadedFiles,
  audit: AuditContext
): Promise<ApplicationResult> {
  const request = await findUsableRequest(dto.token);
  const facultyId = request.facultyId;

  // ── Validate everything before writing anything ──
  if (!(await isValidMobile(dto.mobileNumber))) {
    throw fieldError('mobileNumber', 'Enter a valid mobile number for a supported country');
  }
  const offerings = await describeOfferings(dto.curriculumIds);
  if (offerings.length !== dto.curriculumIds.length || offerings.some((o) => !o.selectable)) {
    throw fieldError(
      'curriculumIds',
      'One of the chosen subjects is no longer offered. Pick your subjects again.'
    );
  }
  const mode = await requireTeachingMode(dto.teachingMode);

  const existing = await prisma.facultyDocument.findMany({
    where: { facultyId },
    select: { id: true, documentType: true, storageKey: true },
  });
  const onFile = new Set(existing.map((d) => d.documentType as string));
  const documents = await checkUploadedDocuments(files, onFile);

  const removable = new Set(
    existing.filter((d) => d.documentType === ADDITIONAL_DOCUMENTS.type).map((d) => d.id)
  );
  if (dto.removeDocumentIds.some((id) => !removable.has(id))) {
    throw fieldError(
      ADDITIONAL_DOCUMENTS.field,
      'Only additional documents can be removed. Reload the page and try again.'
    );
  }
  const extrasAfter =
    removable.size -
    dto.removeDocumentIds.length +
    documents.filter((d) => d.type === ADDITIONAL_DOCUMENTS.type).length;
  if (extrasAfter > ADDITIONAL_DOCUMENTS.max) {
    throw fieldError(
      ADDITIONAL_DOCUMENTS.field,
      `Keep at most ${ADDITIONAL_DOCUMENTS.max} additional documents`
    );
  }

  // Required documents the tutor replaced, and additional documents they removed
  const replacedTypes = new Set(
    documents.filter((d) => d.type !== ADDITIONAL_DOCUMENTS.type).map((d) => d.type as string)
  );
  const outgoing = existing.filter(
    (d) => replacedTypes.has(d.documentType) || dto.removeDocumentIds.includes(d.id)
  );

  // ── Store new files, then write everything in one transaction ──
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
      const consumed = await tx.facultyReuploadRequest.updateMany({
        where: { id: request.id, status: 'PENDING', expiresAt: { gt: now } },
        data: { status: 'COMPLETED', completedAt: now },
      });
      if (consumed.count !== 1) throw invalidLink();

      const profile = await tx.facultyProfile.update({
        where: { id: facultyId },
        data: {
          approvalStatus: 'PENDING',
          rejectionReason: null,
          isPublished: false,
          city: dto.city,
          highestQualification: dto.highestQualification,
          studiedAt: dto.studiedAt,
          teachingExperience: dto.teachingExperience,
          mode: { connect: { code: mode.code } },
          offersOfflineClasses: mode.offersOffline,
          submittedAt: now,
          declarationAcceptedAt: now,
          primarySubject: offerings[0]?.subject ?? null,
          revision: { increment: 1 },
          user: { update: { fullName: dto.fullName, mobileNumber: dto.mobileNumber } },
        },
        select: {
          applicationReference: true,
          userId: true,
          user: { select: { email: true } },
        },
      });

      // Subjects: keep the chosen ones active, switch the rest off (prices refer to them)
      await tx.facultyAssignment.updateMany({
        where: { facultyId, curriculumId: { notIn: dto.curriculumIds } },
        data: { isActive: false },
      });
      await tx.facultyAssignment.updateMany({
        where: { facultyId, curriculumId: { in: dto.curriculumIds } },
        data: { isActive: true },
      });
      await tx.facultyAssignment.createMany({
        data: dto.curriculumIds.map((curriculumId) => ({ facultyId, curriculumId })),
        skipDuplicates: true,
      });

      if (outgoing.length) {
        await tx.facultyDocument.deleteMany({ where: { id: { in: outgoing.map((d) => d.id) } } });
      }
      if (documents.length) {
        await tx.facultyDocument.createMany({
          data: documents.map((doc, i) => ({
            facultyId,
            documentType: doc.type,
            originalFileName: doc.fileName,
            fileSize: doc.file.size,
            mimeType: doc.mime,
            storageKey: stored[i] as string,
            scanStatus: 'PENDING',
          })),
        });
      }
      // Documents kept from before are checked again with the corrected application
      await tx.facultyDocument.updateMany({
        where: { facultyId },
        data: { isVerified: false, verifiedAt: null, verifiedBy: null },
      });
      return profile;
    });

    // The old files are no longer referenced
    await Promise.all(
      outgoing.map((d) =>
        storage
          .delete(d.storageKey)
          .catch((err: unknown) =>
            logger.warn(
              { err: { message: (err as Error).message }, documentId: d.id },
              'Could not delete a replaced faculty document'
            )
          )
      )
    );

    logger.info(
      {
        type: 'faculty',
        facultyId,
        reuploadRequestId: request.id,
        replaced: outgoing.length,
        added: documents.length,
      },
      'Faculty application re-submitted'
    );
    try {
      await logAction({
        ...audit,
        actorId: result.userId,
        severity: 'INFO',
        entity: 'faculty_profile',
        action: 'faculty.application_resubmitted',
        resourceId: facultyId,
        previousValue: { approvalStatus: 'CHANGES_REQUESTED' },
        newValue: {
          approvalStatus: 'PENDING',
          reuploadRequestId: request.id,
          curriculumIds: dto.curriculumIds,
          documentsAdded: documents.map((d) => d.type),
          documentsRemoved: outgoing.map((d) => d.documentType),
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to audit the re-submitted application');
    }
    void getEmailProvider()
      .send(
        reuploadReceivedEmail({
          to: result.user.email,
          fullName: dto.fullName,
          reference: result.applicationReference ?? '',
        })
      )
      .catch((err: unknown) =>
        logger.warn(
          { err: { message: (err as Error).message }, facultyId },
          'Re-upload confirmation email failed'
        )
      );

    return {
      applicationReference: result.applicationReference ?? '',
      fullName: dto.fullName,
      email: result.user.email,
      submittedAt: now,
    };
  } catch (err) {
    await Promise.all(stored.map((key) => storage.delete(key).catch(() => undefined)));
    throw err;
  }
}
