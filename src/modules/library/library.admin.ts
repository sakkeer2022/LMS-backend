import { Prisma, type LibraryMaterialRevision } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { ConflictError, NotFoundError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import { toPrismaPagination } from '@shared/validation/index';
import { logAction, type AuditContext } from '@modules/audit/index';
import { describeOfferings } from '@modules/category-tree/index';
import type { ListSubmissionsQuery, ReviewSubmissionInput } from './library.dto.js';
import { readStoredFile } from './library.faculty.js';
import { contentOf, type ResourceContent } from './library.views.js';

/**
 * Admin › Categories & content › Library content: review queue of tutor submissions (new resources
 * and edits). Approving makes the submission the live version; rejecting keeps the live version (if
 * any) and tells the tutor why. One row per submission (library_material_revisions).
 */

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface SubmissionItem extends ResourceContent {
  id: string;
  resourceId: string;
  revision: number;
  /** An edit of a resource that was approved before (the earlier version is live meanwhile) */
  isEdit: boolean;
  status: SubmissionStatus;
  submittedAt: Date;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  faculty: { id: string; fullName: string; email: string };
  card: { curriculumId: string; subject: string; pathLabel: string };
}

export interface SubmissionDetail extends SubmissionItem {
  /** The live version this edit would replace */
  live: (ResourceContent & { revision: number }) | null;
  history: {
    revision: number;
    status: 'pending' | 'approved' | 'rejected' | 'superseded' | 'withdrawn';
    submittedAt: Date;
    reviewedAt: Date | null;
    reviewNotes: string | null;
  }[];
}

export interface SubmissionCounts {
  pending: number;
  approved: number;
  rejected: number;
}

const STATUS_FILTER: Record<
  ListSubmissionsQuery['status'],
  Prisma.LibraryMaterialRevisionWhereInput
> = {
  pending: { status: 'PENDING' },
  approved: { status: 'APPROVED' },
  rejected: { status: 'REJECTED' },
  all: { status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } },
};

const include = {
  material: {
    select: {
      id: true,
      curriculumId: true,
      facultyId: true,
      status: true,
      faculty: { select: { id: true, user: { select: { fullName: true, email: true } } } },
    },
  },
} satisfies Prisma.LibraryMaterialRevisionInclude;

type Row = Prisma.LibraryMaterialRevisionGetPayload<{ include: typeof include }>;

function whereOf(
  query: Pick<ListSubmissionsQuery, 'status' | 'q' | 'facultyId'>
): Prisma.LibraryMaterialRevisionWhereInput {
  const where: Prisma.LibraryMaterialRevisionWhereInput = {
    ...STATUS_FILTER[query.status],
    material: {
      facultyId: query.facultyId ?? { not: null },
      status: { not: 'WITHDRAWN' },
    },
  };
  if (query.q) {
    where.OR = [
      { title: { contains: query.q, mode: 'insensitive' } },
      { material: { faculty: { user: { fullName: { contains: query.q, mode: 'insensitive' } } } } },
      { material: { faculty: { user: { email: { contains: query.q, mode: 'insensitive' } } } } },
    ];
  }
  return where;
}

async function toItems(rows: Row[]): Promise<SubmissionItem[]> {
  const materialIds = [...new Set(rows.map((r) => r.materialId))];
  const curriculumIds = [
    ...new Set(rows.flatMap((r) => (r.material.curriculumId ? [r.material.curriculumId] : []))),
  ];
  const [firstApproved, labels] = await Promise.all([
    materialIds.length
      ? prisma.libraryMaterialRevision.groupBy({
          by: ['materialId'],
          where: { materialId: { in: materialIds }, status: 'APPROVED' },
          _min: { revision: true },
        })
      : [],
    describeOfferings(curriculumIds),
  ]);
  const firstApprovedOf = new Map(firstApproved.map((g) => [g.materialId, g._min.revision]));
  const labelOf = new Map(labels.map((l) => [l.curriculumId, l]));
  return rows.map((r) => {
    const first = firstApprovedOf.get(r.materialId);
    const curriculumId = r.material.curriculumId ?? '';
    const label = labelOf.get(curriculumId);
    return {
      id: r.id,
      resourceId: r.materialId,
      revision: r.revision,
      isEdit: first !== undefined && first !== null && first < r.revision,
      status: r.status.toLowerCase() as SubmissionStatus,
      ...contentOf(r),
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      reviewNotes: r.reviewNotes,
      faculty: {
        id: r.material.faculty?.id ?? '',
        fullName: r.material.faculty?.user.fullName ?? 'Unknown tutor',
        email: r.material.faculty?.user.email ?? '',
      },
      card: {
        curriculumId,
        subject: label?.subject ?? 'Unknown subject',
        pathLabel: label?.pathLabel ?? '',
      },
    };
  });
}

/** GET /admin/library/submissions: pending oldest first; decided newest first. */
export async function listSubmissions(
  query: ListSubmissionsQuery
): Promise<PaginatedResult<SubmissionItem>> {
  const where = whereOf(query);
  const orderBy: Prisma.LibraryMaterialRevisionOrderByWithRelationInput[] =
    query.status === 'pending'
      ? [{ submittedAt: 'asc' }, { id: 'asc' }]
      : [{ reviewedAt: { sort: 'desc', nulls: 'first' } }, { submittedAt: 'desc' }, { id: 'asc' }];
  const [rows, total] = await Promise.all([
    prisma.libraryMaterialRevision.findMany({
      where,
      include,
      orderBy,
      ...toPrismaPagination(query),
    }),
    prisma.libraryMaterialRevision.count({ where }),
  ]);
  return { items: await toItems(rows), meta: buildPaginationMeta(total, query.page, query.limit) };
}

/** GET /admin/library/submissions/counts: the tab badges. */
export async function submissionCounts(
  query: Pick<ListSubmissionsQuery, 'q' | 'facultyId'>
): Promise<SubmissionCounts> {
  const [pending, approved, rejected] = await Promise.all(
    (['pending', 'approved', 'rejected'] as const).map((status) =>
      prisma.libraryMaterialRevision.count({ where: whereOf({ ...query, status }) })
    )
  );
  return { pending, approved, rejected };
}

async function findRow(submissionId: string): Promise<Row> {
  const row = await prisma.libraryMaterialRevision.findFirst({
    where: { id: submissionId, material: { facultyId: { not: null } } },
    include,
  });
  if (!row) throw new NotFoundError('Submission');
  return row;
}

/** GET /admin/library/submissions/:id: the submission, the live version it would replace, history. */
export async function getSubmission(submissionId: string): Promise<SubmissionDetail> {
  const row = await findRow(submissionId);
  const [[item], material, revisions] = await Promise.all([
    toItems([row]),
    prisma.libraryMaterial.findUniqueOrThrow({ where: { id: row.materialId } }),
    prisma.libraryMaterialRevision.findMany({
      where: { materialId: row.materialId },
      orderBy: { revision: 'desc' },
      select: {
        revision: true,
        status: true,
        submittedAt: true,
        reviewedAt: true,
        reviewNotes: true,
      },
    }),
  ]);
  const live =
    material.status === 'APPROVED' && material.revision !== row.revision
      ? { ...contentOf(material), revision: material.revision }
      : null;
  return {
    ...(item as SubmissionItem),
    description: row.description,
    live,
    history: revisions.map((r) => ({
      revision: r.revision,
      status: r.status.toLowerCase() as SubmissionDetail['history'][number]['status'],
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      reviewNotes: r.reviewNotes,
    })),
  };
}

/**
 * PUT /admin/library/submissions/:id/review. Approve: the submission becomes the live version (the
 * subject card must still be approved and active). Reject: needs notes; a resource that was never
 * approved becomes REJECTED, a live one keeps its approved version.
 */
export async function reviewSubmission(
  submissionId: string,
  input: ReviewSubmissionInput,
  audit: AuditContext
): Promise<SubmissionDetail> {
  const reviewerId = audit.actorId;
  if (!reviewerId) throw new NotFoundError('Reviewer');
  const now = new Date();
  const row = await findRow(submissionId);
  const notes = input.reason ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM library_materials WHERE id = ${row.materialId}::uuid FOR UPDATE`;
    const current: LibraryMaterialRevision | null = await tx.libraryMaterialRevision.findUnique({
      where: { id: submissionId },
    });
    if (!current || current.status !== 'PENDING') {
      throw new ConflictError(
        current?.status === 'SUPERSEDED'
          ? 'The tutor changed this resource again; review the newer version'
          : `This submission was already ${current?.status.toLowerCase() ?? 'removed'}`,
        { code: 'SUBMISSION_ALREADY_DECIDED' }
      );
    }
    if (input.status === 'approved') {
      const card = await tx.facultyAssignment.findFirst({
        where: {
          facultyId: row.material.facultyId as string,
          curriculumId: row.material.curriculumId as string,
          isActive: true,
          status: 'APPROVED',
        },
        select: { id: true },
      });
      if (!card) {
        throw new ConflictError(
          'The tutor’s subject card is no longer active; reject this instead',
          {
            code: 'SUBJECT_CARD_NOT_ACTIVE',
          }
        );
      }
    }
    await tx.libraryMaterialRevision.update({
      where: { id: submissionId },
      data: {
        status: input.status === 'approved' ? 'APPROVED' : 'REJECTED',
        reviewedById: reviewerId,
        reviewedAt: now,
        reviewNotes: notes,
      },
    });
    const material = await tx.libraryMaterial.findUniqueOrThrow({ where: { id: row.materialId } });
    if (input.status === 'approved') {
      await tx.libraryMaterial.update({
        where: { id: row.materialId },
        data: {
          status: 'APPROVED',
          revision: current.revision,
          kind: current.kind,
          title: current.title,
          description: current.description,
          body: current.body,
          storageKey: current.storageKey,
          originalFileName: current.originalFileName,
          fileSize: current.fileSize,
          mimeType: current.mimeType,
        },
      });
    } else if (material.status !== 'APPROVED') {
      await tx.libraryMaterial.update({
        where: { id: row.materialId },
        data: { status: 'REJECTED' },
      });
    }
    await tx.libraryReview.create({
      data: {
        materialId: row.materialId,
        reviewerId,
        decision: input.status === 'approved' ? 'APPROVED' : 'REJECTED',
        notes,
        revisionId: submissionId,
      },
    });
  });

  logger.info(
    { type: 'library', submissionId, resourceId: row.materialId, status: input.status },
    'Library submission reviewed'
  );
  try {
    await logAction({
      ...audit,
      severity: 'INFO',
      entity: 'library_material',
      action:
        input.status === 'approved' ? 'library.submission_approved' : 'library.submission_rejected',
      resourceId: row.materialId,
      newValue: { submissionId, revision: row.revision, ...(notes && { notes }) },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to audit a library review');
  }
  return getSubmission(submissionId);
}

/** GET /admin/library/submissions/:id/file?version=submitted|live. Audited. */
export async function getSubmissionFile(
  submissionId: string,
  version: 'submitted' | 'live',
  audit: AuditContext
): Promise<{ body: Buffer; contentType: string; fileName: string }> {
  const row = await findRow(submissionId);
  const source =
    version === 'live'
      ? await prisma.libraryMaterial.findFirst({
          where: { id: row.materialId, status: 'APPROVED' },
        })
      : row;
  if (!source) throw new NotFoundError('Live version');
  const file = await readStoredFile(source);
  try {
    await logAction({
      ...audit,
      severity: 'INFO',
      entity: 'library_material',
      action: 'library.file_viewed',
      resourceId: row.materialId,
      newValue: { submissionId, version },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to audit a library file view');
  }
  return file;
}
