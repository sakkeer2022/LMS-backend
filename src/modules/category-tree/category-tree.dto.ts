import { z } from 'zod';
import { paginationQuerySchema, uuidParams } from '@shared/validation/index';
import { CODE_PATTERN, MAX_CODE_LENGTH, MAX_NAME_LENGTH } from './category-tree.rules.js';

const code = z
  .string()
  .trim()
  .min(1)
  .max(MAX_CODE_LENGTH)
  .regex(CODE_PATTERN, 'Use lowercase letters, digits, "-" or "_", starting with a letter');
const name = z.string().trim().min(1).max(MAX_NAME_LENGTH);
const version = z.number().int().min(1);

export const CategoryIdParamsDto = uuidParams('categoryId');

// ── Admin ───────────────────────────────────────────────────────────────────
/** Without parentId: the whole tree (cached). With parentId: only its direct children (lazy load). */
export const AdminTreeQueryDto = z.object({ parentId: z.uuid().optional() }).strict();

export const CreateRootDto = z.object({ code, name }).strict();
export const CreateChildDto = z.object({ code, name }).strict();

export const UpdateCategoryDto = z
  .object({
    version,
    name: name.optional(),
    code: code.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.code !== undefined || v.isActive !== undefined, {
    message: 'Provide name, code or isActive',
  });

export const ReorderDto = z
  .object({
    parentId: z.uuid().nullable(),
    orderedIds: z
      .array(z.uuid())
      .min(1)
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'orderedIds must not repeat' }),
  })
  .strict();

export const MoveDto = z
  .object({
    version,
    parentId: z.uuid().nullable(),
    // Position among the new parent's children (0 = first). Omitted: placed last.
    index: z.number().int().min(0).max(10000).optional(),
  })
  .strict();

// ── Subjects of a leaf ──────────────────────────────────────────────────────
export const LeafSubjectParamsDto = z.object({ categoryId: z.uuid(), subjectId: z.uuid() });
export const SubjectIdParamsDto = uuidParams('subjectId');

/** Attach an existing subject, or create one by name and attach it. */
export const AttachSubjectDto = z
  .union([
    z.object({ subjectId: z.uuid() }).strict(),
    z.object({ name }).strict(),
  ]);
export const SetOfferingActiveDto = z.object({ isActive: z.boolean() }).strict();
export const UpdateSubjectDto = z
  .object({ name: name.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.isActive !== undefined, {
    message: 'Provide name or isActive',
  });

export const DeleteQueryDto = z.object({ version: z.coerce.number().int().min(1) }).strict();

// ── Learner ─────────────────────────────────────────────────────────────────
export const LearnerChildrenQueryDto = z.object({ parentId: z.uuid().optional() }).strict();

export const LearnerLeavesQueryDto = paginationQuerySchema
  .extend({
    under: z.uuid().optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const LearnerLeafQueryDto = z
  .object({ boardId: z.uuid().optional(), levelId: z.uuid().optional() })
  .strict();

export const ResolveOfferingQueryDto = z
  .object({ subjectId: z.uuid(), boardId: z.uuid().optional(), levelId: z.uuid().optional() })
  .strict();

export type CreateNodeInput = z.infer<typeof CreateRootDto>;
export type UpdateCategoryInput = z.infer<typeof UpdateCategoryDto>;
export type AttachSubjectInput = z.infer<typeof AttachSubjectDto>;
export type UpdateSubjectInput = z.infer<typeof UpdateSubjectDto>;
export type ReorderInput = z.infer<typeof ReorderDto>;
export type MoveInput = z.infer<typeof MoveDto>;
export type LearnerLeavesQuery = z.infer<typeof LearnerLeavesQueryDto>;
