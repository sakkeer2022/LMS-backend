import { prisma } from '@infrastructure/database/index';
import { getObjectStorage, StorageNotFoundError } from '@infrastructure/storage/index';
import { getEmailProvider } from '@infrastructure/email/index';
import { ConflictError, NotFoundError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { logAction, type AuditContext } from '@modules/audit/audit.service.js';
import { ONBOARDING_DOCUMENTS, isPreviewableMime } from './faculty.documents.js';
import { TEACHING_EXPERIENCE_LABELS, type TeachingExperience } from './faculty.onboarding.dto.js';
import {
  getFacultyAccess,
  onTutorPricesChanged,
  pricingStatusOf,
  type PricingStatus,
} from './faculty.access.js';
import { applicationApprovedEmail, applicationRejectedEmail } from './faculty.emails.js';
import type { DocumentVerificationInput, ReviewFacultyInput } from './faculty.review.dto.js';
import type { FacultyRowStatus } from './faculty.list.js';

/**
 * Admin verification of a tutor (screen 27b, LMS-39): read the application, open the
 * documents, mark them verified, then approve ("Verify & publish") or reject with a reason.
 * Approving does not let the tutor sign in yet: every subject needs a price first (screen 29).
 */

const DOCUMENT_LABELS: Record<string, string> = {
  ...Object.fromEntries(ONBOARDING_DOCUMENTS.map((d) => [d.type, d.label])),
  EXPERIENCE_LETTER: 'Experience letter',
  BACKGROUND_CHECK: 'Background check',
  OTHER: 'Other document',
};

/** Same rule as the roster query (faculty.list.ts). */
export function profileStatus(p: {
  isActive: boolean;
  approvalStatus: string;
  isPublished: boolean;
  user: { isActive: boolean; status: string };
}): FacultyRowStatus {
  if (!p.isActive || !p.user.isActive || ['SUSPENDED', 'INACTIVE'].includes(p.user.status))
    return 'suspended';
  if (p.approvalStatus === 'APPROVED') return p.isPublished ? 'published' : 'verified';
  if (p.approvalStatus === 'REJECTED') return 'rejected';
  return 'pending';
}

export interface FacultyDetail {
  id: string;
  fullName: string;
  email: string;
  mobileNumber: string | null;
  city: string | null;
  applicationReference: string | null;
  appliedAt: Date;
  submittedAt: Date | null;
  status: FacultyRowStatus;
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  isPublished: boolean;
  isActive: boolean;
  revision: number;
  rejectionReason: string | null;
  approvedAt: Date | null;
  screening: {
    highestQualification: string | null;
    studiedAt: string | null;
    teachingExperience: { code: string; label: string } | null;
    offersOfflineClasses: boolean;
  };
  documents: {
    id: string;
    type: string;
    label: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    uploadedAt: Date;
    isVerified: boolean;
    verifiedAt: Date | null;
    scanStatus: string;
    previewable: boolean;
  }[];
  subjects: {
    assignmentId: string;
    curriculumId: string;
    subject: string;
    pathLabel: string;
    sessionPricePaise: number | null;
    studentPaysPaise: number | null;
  }[];
  pricing: PricingStatus;
  consentDecidedAt: Date | null;
}

export async function getFacultyDetail(facultyId: string): Promise<FacultyDetail> {
  const profile = await prisma.facultyProfile.findUnique({
    where: { id: facultyId },
    include: {
      user: {
        select: {
          fullName: true,
          email: true,
          mobileNumber: true,
          isActive: true,
          status: true,
          deletedAt: true,
        },
      },
      documents: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!profile || profile.user.deletedAt) throw new NotFoundError('Faculty profile');
  const access = await getFacultyAccess({ facultyId });
  const experience = profile.teachingExperience as TeachingExperience | null;
  return {
    id: profile.id,
    fullName: profile.user.fullName,
    email: profile.user.email,
    mobileNumber: profile.user.mobileNumber,
    city: profile.city,
    applicationReference: profile.applicationReference,
    appliedAt: profile.createdAt,
    submittedAt: profile.submittedAt,
    status: profileStatus(profile),
    approvalStatus: profile.approvalStatus.toLowerCase() as FacultyDetail['approvalStatus'],
    isPublished: profile.isPublished,
    isActive: profile.isActive,
    revision: profile.revision,
    rejectionReason: profile.rejectionReason,
    approvedAt: profile.approvedAt,
    screening: {
      highestQualification: profile.highestQualification,
      studiedAt: profile.studiedAt,
      teachingExperience:
        experience && TEACHING_EXPERIENCE_LABELS[experience]
          ? { code: experience, label: TEACHING_EXPERIENCE_LABELS[experience] }
          : null,
      offersOfflineClasses: profile.offersOfflineClasses,
    },
    documents: profile.documents.map((d) => ({
      id: d.id,
      type: d.documentType,
      label: DOCUMENT_LABELS[d.documentType] ?? 'Document',
      fileName: d.originalFileName,
      mimeType: d.mimeType,
      fileSize: d.fileSize,
      uploadedAt: d.createdAt,
      isVerified: d.isVerified,
      verifiedAt: d.verifiedAt,
      scanStatus: d.scanStatus.toLowerCase(),
      previewable: isPreviewableMime(d.mimeType),
    })),
    subjects: access.subjects.map((s) => ({
      assignmentId: s.assignmentId,
      curriculumId: s.curriculumId,
      subject: s.subject,
      pathLabel: s.pathLabel,
      sessionPricePaise: s.price?.sessionPricePaise ?? null,
      studentPaysPaise: s.price?.studentPaysPaise ?? null,
    })),
    pricing: pricingStatusOf(access),
    consentDecidedAt: access.consentDecidedAt,
  };
}

export interface DocumentFile {
  body: Buffer;
  contentType: string;
  fileName: string;
  previewable: boolean;
}

/** The document bytes for an admin. Every access is audited. */
export async function getDocumentFile(
  facultyId: string,
  documentId: string,
  audit: AuditContext
): Promise<DocumentFile> {
  const doc = await prisma.facultyDocument.findFirst({ where: { id: documentId, facultyId } });
  if (!doc) throw new NotFoundError('Document');
  let stored;
  try {
    stored = await getObjectStorage().get(doc.storageKey);
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      logger.error(
        { documentId, facultyId },
        'Faculty document row exists but its file is missing'
      );
      throw new NotFoundError('Document file');
    }
    throw err;
  }
  try {
    await logAction({
      ...audit,
      severity: 'SECURITY',
      entity: 'faculty_document',
      action: 'faculty.document_viewed',
      resourceId: documentId,
      newValue: { facultyId, documentType: doc.documentType },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to audit a document view');
  }
  return {
    body: stored.body,
    contentType: doc.mimeType,
    fileName: doc.originalFileName,
    previewable: isPreviewableMime(doc.mimeType),
  };
}

export async function setDocumentVerified(
  facultyId: string,
  documentId: string,
  input: DocumentVerificationInput,
  audit: AuditContext
): Promise<FacultyDetail> {
  const updated = await prisma.facultyDocument.updateMany({
    where: { id: documentId, facultyId },
    data: input.isVerified
      ? { isVerified: true, verifiedAt: new Date(), verifiedBy: audit.actorId ?? null }
      : { isVerified: false, verifiedAt: null, verifiedBy: null },
  });
  if (updated.count !== 1) throw new NotFoundError('Document');
  try {
    await logAction({
      ...audit,
      severity: 'INFO',
      entity: 'faculty_document',
      action: input.isVerified ? 'faculty.document_verified' : 'faculty.document_unverified',
      resourceId: documentId,
      newValue: { facultyId },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to audit a document verification');
  }
  return getFacultyDetail(facultyId);
}

/**
 * Approve or reject a pending application. Approving verifies every document the admin has
 * not marked yet, records the approver and sets publication as chosen; rejecting needs a
 * reason and unpublishes. Both use the profile revision against concurrent edits, and email
 * the tutor.
 */
export async function reviewFaculty(
  facultyId: string,
  input: ReviewFacultyInput,
  audit: AuditContext
): Promise<FacultyDetail> {
  const now = new Date();
  const profile = await prisma.$transaction(async (tx) => {
    const current = await tx.facultyProfile.findUnique({
      where: { id: facultyId },
      select: {
        approvalStatus: true,
        revision: true,
        user: { select: { email: true, fullName: true, deletedAt: true } },
      },
    });
    if (!current || current.user.deletedAt) throw new NotFoundError('Faculty profile');
    if (!['PENDING', 'CHANGES_REQUESTED'].includes(current.approvalStatus)) {
      throw new ConflictError(
        `This application was already ${current.approvalStatus.toLowerCase()}`,
        {
          code: 'INVALID_TRANSITION',
        }
      );
    }
    const approve = input.decision === 'approve';
    const changed = await tx.facultyProfile.updateMany({
      where: { id: facultyId, revision: input.expectedRevision },
      data: approve
        ? {
            approvalStatus: 'APPROVED',
            approvedAt: now,
            approvedBy: audit.actorId ?? null,
            isPublished: input.publish,
            rejectionReason: null,
            revision: { increment: 1 },
          }
        : {
            approvalStatus: 'REJECTED',
            isPublished: false,
            rejectionReason: input.reason ?? null,
            revision: { increment: 1 },
          },
    });
    if (changed.count !== 1) {
      throw new ConflictError('Someone else changed this application; reload and try again', {
        code: 'STALE_REVISION',
      });
    }
    if (approve) {
      await tx.facultyDocument.updateMany({
        where: { facultyId, isVerified: false },
        data: { isVerified: true, verifiedAt: now, verifiedBy: audit.actorId ?? null },
      });
    }
    return current;
  });

  logger.info(
    { type: 'faculty', facultyId, decision: input.decision },
    'Faculty application reviewed'
  );
  try {
    await logAction({
      ...audit,
      severity: 'SECURITY',
      entity: 'faculty_profile',
      action: input.decision === 'approve' ? 'faculty.approved' : 'faculty.rejected',
      resourceId: facultyId,
      previousValue: { approvalStatus: profile.approvalStatus, revision: profile.revision },
      newValue: {
        approvalStatus: input.decision === 'approve' ? 'APPROVED' : 'REJECTED',
        isPublished: input.decision === 'approve' ? input.publish : false,
        ...(input.reason && { reason: input.reason }),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to audit a faculty review');
  }

  const email =
    input.decision === 'approve'
      ? applicationApprovedEmail({ to: profile.user.email, fullName: profile.user.fullName })
      : applicationRejectedEmail({
          to: profile.user.email,
          fullName: profile.user.fullName,
          reason: input.reason ?? '',
        });
  void getEmailProvider()
    .send(email)
    .catch((err: unknown) =>
      logger.warn({ err: { message: (err as Error).message }, facultyId }, 'Review email failed')
    );

  // Prices may already exist (re-review after a correction)
  if (input.decision === 'approve') await onTutorPricesChanged(facultyId);
  return getFacultyDetail(facultyId);
}
