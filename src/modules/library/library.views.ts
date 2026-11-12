import type { LibraryMaterial, LibraryMaterialRevision } from '@prisma/client';
import { isPreviewableMime } from '@modules/faculty/index';
import type { ResourceKind } from './library.dto.js';

/**
 * What a tutor sees for a resource. `reviewState` folds the material and its latest submission
 * into one label for the Library modal:
 *   pending        never approved, waiting for review
 *   rejected       never approved, the last submission was rejected (edit to submit again)
 *   approved       live
 *   edit_pending   live; an edit waits for review (students still see the approved version)
 *   edit_rejected  live; the last edit was rejected (the approved version stays)
 */
export type ReviewState = 'pending' | 'rejected' | 'approved' | 'edit_pending' | 'edit_rejected';

export interface FileInfo {
  name: string;
  size: number;
  mimeType: string;
  /** PDF and images can be shown inline */
  previewable: boolean;
}

export interface ResourceContent {
  kind: ResourceKind;
  title: string;
  description: string | null;
  /** Note text */
  body: string | null;
  file: FileInfo | null;
}

export interface ResourceView extends ResourceContent {
  id: string;
  curriculumId: string;
  reviewState: ReviewState;
  /** The version the content fields hold */
  revision: number;
  /** The edit waiting for review, when the resource is live */
  pendingEdit: (ResourceContent & { revision: number; submittedAt: Date }) | null;
  /** The admin's latest decision on this resource */
  lastDecision: {
    decision: 'approved' | 'rejected';
    notes: string | null;
    decidedAt: Date;
    revision: number;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

type Content = Pick<
  LibraryMaterial,
  | 'kind'
  | 'title'
  | 'description'
  | 'body'
  | 'storageKey'
  | 'originalFileName'
  | 'fileSize'
  | 'mimeType'
>;

export function kindOf(kind: LibraryMaterial['kind']): ResourceKind {
  return kind === 'NOTE' ? 'note' : 'file';
}

export function contentOf(row: Content): ResourceContent {
  return {
    kind: kindOf(row.kind),
    title: row.title,
    description: row.description,
    body: row.kind === 'NOTE' ? row.body : null,
    file:
      row.kind === 'DOCUMENT' && row.storageKey && row.mimeType
        ? {
            name: row.originalFileName ?? 'file',
            size: row.fileSize ?? 0,
            mimeType: row.mimeType,
            previewable: isPreviewableMime(row.mimeType),
          }
        : null,
  };
}

/** Revisions newest first. */
export function toResourceView(
  material: LibraryMaterial,
  revisions: readonly LibraryMaterialRevision[]
): ResourceView {
  const live = material.status === 'APPROVED';
  const pending = revisions.find((r) => r.status === 'PENDING');
  const decided = revisions.find((r) => r.status === 'APPROVED' || r.status === 'REJECTED');
  const latest = revisions.find((r) => r.status !== 'SUPERSEDED' && r.status !== 'WITHDRAWN');
  let reviewState: ReviewState;
  if (!live) reviewState = material.status === 'REJECTED' ? 'rejected' : 'pending';
  else if (pending) reviewState = 'edit_pending';
  else reviewState = latest?.status === 'REJECTED' ? 'edit_rejected' : 'approved';

  return {
    id: material.id,
    curriculumId: material.curriculumId as string,
    ...contentOf(material),
    reviewState,
    revision: material.revision,
    pendingEdit:
      live && pending
        ? { ...contentOf(pending), revision: pending.revision, submittedAt: pending.submittedAt }
        : null,
    lastDecision:
      decided && decided.reviewedAt
        ? {
            decision: decided.status === 'APPROVED' ? 'approved' : 'rejected',
            notes: decided.reviewNotes,
            decidedAt: decided.reviewedAt,
            revision: decided.revision,
          }
        : null,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  };
}
