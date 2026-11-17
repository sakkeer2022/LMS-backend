import { z } from 'zod';
import { paginationQuerySchema } from '@shared/validation/index';

/**
 * Faculty library (decided 2026-11-12): a resource is a FILE (PDF, JPG, PNG, DOC, DOCX, PPT, PPTX,
 * checked like onboarding documents) or a NOTE (plain text). Links are not offered to tutors.
 * Create and edit are multipart/form-data (the file in `file`), so every field arrives as a string.
 */

export const RESOURCE_KINDS = ['file', 'note'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const NOTE_MAX_LENGTH = 20000;

const title = z
  .string({ error: 'Enter a title' })
  .trim()
  .min(2, 'Enter a title')
  .max(150, 'Title must be at most 150 characters');

const description = z
  .string()
  .trim()
  .max(1000, 'Description must be at most 1000 characters')
  .optional()
  .transform((value) => (value ? value : null));

const body = z
  .string()
  .max(
    NOTE_MAX_LENGTH,
    `The note must be at most ${NOTE_MAX_LENGTH.toLocaleString('en-IN')} characters`
  )
  .optional()
  .transform((value) => (value && value.trim() ? value.replace(/\r\n/g, '\n') : null));

const fields = {
  kind: z.enum(RESOURCE_KINDS, { error: 'Choose File or Note' }),
  title,
  description,
  body,
};

function noteNeedsBody(
  dto: { kind: ResourceKind; body: string | null },
  ctx: z.RefinementCtx
): void {
  if (dto.kind === 'note' && !dto.body) {
    ctx.addIssue({ code: 'custom', path: ['body'], message: 'Write the note' });
  }
}

export const CreateResourceDto = z
  .strictObject({ curriculumId: z.uuid({ error: 'Choose a subject card' }), ...fields })
  .superRefine(noteNeedsBody);

/** An edit sends the whole resource again; a file resource without a new file keeps its file. */
export const UpdateResourceDto = z.strictObject(fields).superRefine(noteNeedsBody);

export const ResourceParamsDto = z.strictObject({ resourceId: z.uuid() });

export const ListResourcesQueryDto = z.strictObject({ curriculumId: z.uuid() });

/** Which version's file: the live one or the one waiting for review. */
export const ResourceFileQueryDto = z.strictObject({
  version: z.enum(['live', 'pending']).default('live'),
});

// ── Admin ──

export const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected', 'all'] as const;

export const ListSubmissionsQueryDto = paginationQuerySchema
  .extend({
    status: z.enum(SUBMISSION_STATUSES).default('pending'),
    q: z.string().trim().min(1).max(100).optional(),
    facultyId: z.uuid().optional(),
  })
  .strict();

export const SubmissionParamsDto = z.strictObject({ submissionId: z.uuid() });

export const SubmissionFileQueryDto = z.strictObject({
  version: z.enum(['submitted', 'live']).default('submitted'),
});

/** Field names follow the earlier library draft contract (LibraryReview): status and reason. */
export const ReviewSubmissionDto = z
  .strictObject({
    status: z.enum(['approved', 'rejected']),
    reason: z.string().trim().max(1000).optional(),
  })
  .superRefine((dto, ctx) => {
    if (dto.status === 'rejected' && !dto.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Tell the tutor why it was rejected',
      });
    }
  });

export type CreateResourceInput = z.output<typeof CreateResourceDto>;
export type UpdateResourceInput = z.output<typeof UpdateResourceDto>;
export type ListSubmissionsQuery = z.output<typeof ListSubmissionsQueryDto>;
export type ReviewSubmissionInput = z.output<typeof ReviewSubmissionDto>;

/** Student Library list: a subject tab, a search and a sort, paged. */
export const StudentLibraryQueryDto = z.strictObject({
  ...paginationQuerySchema.shape,
  subjectId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['recent', 'updated', 'title']).default('recent'),
});
export type StudentLibraryQuery = z.infer<typeof StudentLibraryQueryDto>;
