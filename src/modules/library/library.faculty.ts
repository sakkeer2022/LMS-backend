import type { LibraryMaterial, LibraryMaterialKind, Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { getStorage } from '@infrastructure/storage/index';
import { NotFoundError, ValidationError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { logAction, type AuditContext } from '@modules/audit/index';
import {
  facultyIdOfUser,
  listMySubjectCards,
  requireActiveSubjectCard,
  type SubjectCardView,
} from '@modules/faculty/index';
import type { CreateResourceInput, ResourceKind, UpdateResourceInput } from './library.dto.js';
import { checkResourceFile, libraryStorageKey, type CheckedFile } from './library.files.js';
import { toResourceView, type ResourceView } from './library.views.js';

/**
 * The tutor's library (Workflow B). Resources belong to one of the tutor's subject cards and can be
 * added, edited and withdrawn only while that card is approved and active. Every add or edit is a
 * submission (library_material_revisions) that an admin approves or rejects:
 *   - before the first approval, the material mirrors its latest submission and stays PENDING;
 *   - once approved, an edit waits as a PENDING revision and the approved version stays live;
 *   - a newer edit before review supersedes the waiting one (one PENDING revision per material).
 */

export interface LibraryCard extends SubjectCardView {
  counts: {
    /** Live resources */
    approved: number;
    /** New resources and edits waiting for review */
    inReview: number;
    /** Never-approved resources whose submission was rejected */
    rejected: number;
  };
}

export interface LibraryOverview {
  cards: LibraryCard[];
}

const DECIDED_OR_PENDING: Prisma.LibraryMaterialRevisionWhereInput = {
  status: { in: ['PENDING', 'APPROVED', 'REJECTED'] },
};

/** GET /faculty/me/library: the tutor's subject cards with resource counts. */
export async function getLibraryOverview(userId: string): Promise<LibraryOverview> {
  const { cards } = await listMySubjectCards(userId);
  const facultyId = await facultyIdOfUser(userId);
  const [byStatus, pendingEdits] = await Promise.all([
    prisma.libraryMaterial.groupBy({
      by: ['curriculumId', 'status'],
      where: { facultyId, status: { not: 'WITHDRAWN' } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ curriculum_id: string; n: number }[]>`
      SELECT m.curriculum_id, count(*)::int AS n
      FROM library_material_revisions r JOIN library_materials m ON m.id = r.material_id
      WHERE m.faculty_id = ${facultyId}::uuid AND m.status = 'APPROVED' AND r.status = 'PENDING'
      GROUP BY m.curriculum_id`,
  ]);
  const count = (curriculumId: string, status: string): number =>
    byStatus.find((g) => g.curriculumId === curriculumId && g.status === status)?._count._all ?? 0;
  return {
    cards: cards.map((card) => ({
      ...card,
      counts: {
        approved: count(card.curriculumId, 'APPROVED'),
        inReview:
          count(card.curriculumId, 'PENDING') +
          (pendingEdits.find((e) => e.curriculum_id === card.curriculumId)?.n ?? 0),
        rejected: count(card.curriculumId, 'REJECTED'),
      },
    })),
  };
}

async function loadViews(where: Prisma.LibraryMaterialWhereInput): Promise<ResourceView[]> {
  const materials = await prisma.libraryMaterial.findMany({
    where,
    // The waiting edit (if any) is the newest; the latest decision is right after it
    include: { revisions: { where: DECIDED_OR_PENDING, orderBy: { revision: 'desc' }, take: 2 } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  return materials.map((m) => toResourceView(m, m.revisions));
}

/** GET /faculty/me/library/resources?curriculumId=: one card's resources (any card the tutor holds). */
export async function listResources(userId: string, curriculumId: string): Promise<ResourceView[]> {
  const facultyId = await facultyIdOfUser(userId);
  const card = await prisma.facultyAssignment.findFirst({
    where: { facultyId, curriculumId, isActive: true },
    select: { id: true },
  });
  if (!card) throw new NotFoundError('Subject card');
  return loadViews({ facultyId, curriculumId, status: { not: 'WITHDRAWN' } });
}

async function ownedMaterial(userId: string, resourceId: string): Promise<LibraryMaterial> {
  const facultyId = await facultyIdOfUser(userId);
  const material = await prisma.libraryMaterial.findFirst({
    where: { id: resourceId, facultyId, status: { not: 'WITHDRAWN' } },
  });
  if (!material) throw new NotFoundError('Resource');
  return material;
}

function fieldError(field: string, message: string): ValidationError {
  return new ValidationError(message, {
    code: 'RESOURCE_INVALID',
    fieldErrors: { [field]: [message] },
  });
}

const KIND: Record<ResourceKind, LibraryMaterialKind> = { file: 'DOCUMENT', note: 'NOTE' };

interface StoredContent {
  kind: LibraryMaterialKind;
  title: string;
  description: string | null;
  body: string | null;
  storageKey: string | null;
  originalFileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
}

function contentFrom(
  input: { kind: ResourceKind; title: string; description: string | null; body: string | null },
  file: (CheckedFile & { key: string }) | null,
  keep: Pick<StoredContent, 'storageKey' | 'originalFileName' | 'fileSize' | 'mimeType'> | null
): StoredContent {
  const isFile = input.kind === 'file';
  return {
    kind: KIND[input.kind],
    title: input.title,
    description: input.description,
    body: isFile ? null : input.body,
    storageKey: isFile ? (file?.key ?? keep?.storageKey ?? null) : null,
    originalFileName: isFile ? (file?.fileName ?? keep?.originalFileName ?? null) : null,
    fileSize: isFile ? (file?.size ?? keep?.fileSize ?? null) : null,
    mimeType: isFile ? (file?.mime ?? keep?.mimeType ?? null) : null,
  };
}

/** Checks and stores the upload (if any); the caller deletes the key when its write fails. */
async function storeUpload(
  kind: ResourceKind,
  upload: Express.Multer.File | undefined
): Promise<(CheckedFile & { key: string }) | null> {
  if (!upload) return null;
  if (kind !== 'file') throw fieldError('file', 'A note has no file; choose File to upload one');
  const checked = await checkResourceFile(upload);
  const key = libraryStorageKey();
  await getStorage().put(key, checked.buffer, checked.mime);
  return { ...checked, key };
}

async function discard(key: string | undefined): Promise<void> {
  if (key)
    await getStorage()
      .delete(key)
      .catch(() => undefined);
}

async function audited(
  audit: AuditContext,
  action: string,
  resourceId: string,
  newValue: Record<string, unknown>
): Promise<void> {
  try {
    await logAction({
      ...audit,
      severity: 'INFO',
      entity: 'library_material',
      action,
      resourceId,
      newValue,
    });
  } catch (err) {
    logger.error({ err, action }, 'Failed to audit a library change');
  }
}

/** POST /faculty/me/library/resources: a new resource, PENDING until an admin approves it. */
export async function createResource(
  userId: string,
  input: CreateResourceInput,
  upload: Express.Multer.File | undefined,
  audit: AuditContext
): Promise<ResourceView> {
  const { facultyId } = await requireActiveSubjectCard(userId, input.curriculumId);
  if (input.kind === 'file' && !upload) throw fieldError('file', 'Choose a file to upload');
  const file = await storeUpload(input.kind, upload);
  const content = contentFrom(input, file, null);
  let id: string;
  try {
    id = await prisma.$transaction(async (tx) => {
      const material = await tx.libraryMaterial.create({
        data: {
          ...content,
          audience: 'STUDENT',
          status: 'PENDING',
          curriculumId: input.curriculumId,
          facultyId,
          uploadedBy: userId,
          revision: 1,
        },
        select: { id: true },
      });
      await tx.libraryMaterialRevision.create({
        data: { ...content, materialId: material.id, revision: 1, submittedById: userId },
      });
      return material.id;
    });
  } catch (err) {
    await discard(file?.key);
    throw err;
  }
  logger.info({ type: 'library', resourceId: id, facultyId }, 'Library resource submitted');
  await audited(audit, 'library.resource_submitted', id, {
    curriculumId: input.curriculumId,
    kind: input.kind,
    title: input.title,
  });
  return (await loadViews({ id }))[0] as ResourceView;
}

/** PUT /faculty/me/library/resources/:id: an edit, reviewed again before it goes live. */
export async function updateResource(
  userId: string,
  resourceId: string,
  input: UpdateResourceInput,
  upload: Express.Multer.File | undefined,
  audit: AuditContext
): Promise<ResourceView> {
  const material = await ownedMaterial(userId, resourceId);
  await requireActiveSubjectCard(userId, material.curriculumId as string);
  const file = await storeUpload(input.kind, upload);
  let revision: number;
  try {
    revision = await prisma.$transaction(async (tx) => {
      // One edit at a time per resource
      await tx.$queryRaw`SELECT 1 FROM library_materials WHERE id = ${resourceId}::uuid FOR UPDATE`;
      const current = await tx.libraryMaterial.findUniqueOrThrow({ where: { id: resourceId } });
      if (current.status === 'WITHDRAWN') throw new NotFoundError('Resource');
      const waiting = await tx.libraryMaterialRevision.findFirst({
        where: { materialId: resourceId, status: 'PENDING' },
      });
      // A file resource edited without a new file keeps the file of the version being edited
      const base = waiting ?? current;
      const content = contentFrom(input, file, base.kind === 'DOCUMENT' ? base : null);
      if (content.kind === 'DOCUMENT' && !content.storageKey) {
        throw fieldError('file', 'Choose a file to upload');
      }
      const last = await tx.libraryMaterialRevision.aggregate({
        where: { materialId: resourceId },
        _max: { revision: true },
      });
      const next = (last._max.revision ?? current.revision) + 1;
      if (waiting) {
        await tx.libraryMaterialRevision.update({
          where: { id: waiting.id },
          data: { status: 'SUPERSEDED' },
        });
      }
      await tx.libraryMaterialRevision.create({
        data: { ...content, materialId: resourceId, revision: next, submittedById: userId },
      });
      // Nothing is live yet: the material shows the latest submission
      if (current.status !== 'APPROVED') {
        await tx.libraryMaterial.update({
          where: { id: resourceId },
          data: { ...content, status: 'PENDING', revision: next },
        });
      }
      return next;
    });
  } catch (err) {
    await discard(file?.key);
    throw err;
  }
  logger.info({ type: 'library', resourceId, revision }, 'Library resource edit submitted');
  await audited(audit, 'library.resource_edited', resourceId, {
    revision,
    kind: input.kind,
    title: input.title,
    replacedFile: Boolean(file),
  });
  return (await loadViews({ id: resourceId }))[0] as ResourceView;
}

/** DELETE /faculty/me/library/resources/:id: withdraw (hidden everywhere; files kept for audit). */
export async function withdrawResource(
  userId: string,
  resourceId: string,
  audit: AuditContext
): Promise<void> {
  const material = await ownedMaterial(userId, resourceId);
  await requireActiveSubjectCard(userId, material.curriculumId as string);
  await prisma.$transaction([
    prisma.libraryMaterial.update({ where: { id: resourceId }, data: { status: 'WITHDRAWN' } }),
    prisma.libraryMaterialRevision.updateMany({
      where: { materialId: resourceId, status: 'PENDING' },
      data: { status: 'WITHDRAWN' },
    }),
  ]);
  logger.info({ type: 'library', resourceId }, 'Library resource withdrawn');
  await audited(audit, 'library.resource_withdrawn', resourceId, {
    previousStatus: material.status,
  });
}

export async function readStoredFile(row: {
  storageKey: string | null;
  mimeType: string | null;
  originalFileName: string | null;
}): Promise<{ body: Buffer; contentType: string; fileName: string }> {
  if (!row.storageKey || !row.mimeType) throw new NotFoundError('File');
  const body = await getStorage().get(row.storageKey);
  if (!body) {
    logger.error({ storageKey: row.storageKey }, 'Library file row exists but its file is missing');
    throw new NotFoundError('File');
  }
  return { body, contentType: row.mimeType, fileName: row.originalFileName ?? 'file' };
}

/** GET /faculty/me/library/resources/:id/file?version=live|pending: the tutor's own file. */
export async function getOwnResourceFile(
  userId: string,
  resourceId: string,
  version: 'live' | 'pending'
): Promise<{ body: Buffer; contentType: string; fileName: string }> {
  const material = await ownedMaterial(userId, resourceId);
  if (version === 'pending') {
    const waiting = await prisma.libraryMaterialRevision.findFirst({
      where: { materialId: resourceId, status: 'PENDING' },
    });
    if (!waiting) throw new NotFoundError('Pending version');
    return readStoredFile(waiting);
  }
  return readStoredFile(material);
}
