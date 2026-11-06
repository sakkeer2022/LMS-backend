import { z } from 'zod';
import { paginationQuerySchema, queryBoolean, uuidParams } from '@shared/validation/index';

// Same pattern as the contract's `code`
const slug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, 'Use lowercase letters, digits, "-" or "_", starting with a letter');
const name = z.string().trim().min(1).max(200);
const sortOrder = z.number().int().min(0).max(100000);
// Archiving has its own endpoint, so writes only move between draft and published
const editableStatus = z.enum(['DRAFT', 'PUBLISHED']);

// ── Master lists (list-only, D12) ───────────────────────────────────────────
export const MasterListQueryDto = paginationQuerySchema.strict();
export const AdminMasterListQueryDto = paginationQuerySchema
  .extend({ isActive: queryBoolean.optional() })
  .strict();
export const LevelListQueryDto = paginationQuerySchema
  .extend({ categoryId: z.uuid().optional() })
  .strict();
export const AdminLevelListQueryDto = LevelListQueryDto.extend({
  isActive: queryBoolean.optional(),
}).strict();
export const CurriculumListQueryDto = paginationQuerySchema
  .extend({
    categoryId: z.uuid().optional(),
    boardId: z.uuid().optional(),
    levelId: z.uuid().optional(),
  })
  .strict();
export const AdminCurriculumListQueryDto = CurriculumListQueryDto.extend({
  isActive: queryBoolean.optional(),
}).strict();

// ── Tree ────────────────────────────────────────────────────────────────────
export const PublicTreeQueryDto = z.object({ categoryId: z.uuid() }).strict();
export const AdminTreeQueryDto = z
  .object({ categoryId: z.uuid(), q: z.string().trim().min(1).max(100).optional() })
  .strict();
export const NodeIdParamsDto = uuidParams('nodeId');

/** Screen 28a: add a whole path by choosing existing values. */
export const CreatePathDto = z
  .object({
    categoryId: z.uuid(),
    subsectionNodeId: z.uuid().optional(),
    boardId: z.uuid().optional(),
    subjectId: z.uuid(),
    levelId: z.uuid(),
    status: editableStatus.default('DRAFT'),
  })
  .strict();

export const CreateNodeDto = z
  .object({
    parentId: z.uuid(),
    type: z.enum(['SUBSECTION', 'BOARD', 'SUBJECT', 'LEVEL']),
    name: name.optional(),
    slug: slug.optional(),
    boardId: z.uuid().optional(),
    subjectId: z.uuid().optional(),
    levelId: z.uuid().optional(),
    sortOrder: sortOrder.optional(),
    status: editableStatus.default('DRAFT'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const refs = [
      ['BOARD', 'boardId', value.boardId],
      ['SUBJECT', 'subjectId', value.subjectId],
      ['LEVEL', 'levelId', value.levelId],
    ] as const;
    for (const [type, key, id] of refs) {
      if (value.type === type && !id) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required for a ${type} node`,
        });
      }
      if (value.type !== type && id) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is only allowed on a ${type} node`,
        });
      }
    }
    if (value.type === 'SUBSECTION' && !value.name) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'name is required for a SUBSECTION node',
      });
    }
  });

export const UpdateNodeDto = z
  .object({
    name: name.optional(),
    slug: slug.optional(),
    sortOrder: sortOrder.optional(),
    status: editableStatus.optional(),
    bookingEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to change',
  });

export const MoveNodeDto = z.object({ parentId: z.uuid() }).strict();

export const ReorderNodesDto = z
  .object({
    parentId: z.uuid(),
    orderedIds: z
      .array(z.uuid())
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'orderedIds must not repeat' }),
  })
  .strict();

export type CreatePathInput = z.infer<typeof CreatePathDto>;
export type CreateNodeInput = z.infer<typeof CreateNodeDto>;
export type UpdateNodeInput = z.infer<typeof UpdateNodeDto>;
export type MoveNodeInput = z.infer<typeof MoveNodeDto>;
export type ReorderNodesInput = z.infer<typeof ReorderNodesDto>;
export type CurriculumListQuery = z.infer<typeof AdminCurriculumListQueryDto>;
export type LevelListQuery = z.infer<typeof AdminLevelListQueryDto>;
export type MasterListQuery = z.infer<typeof AdminMasterListQueryDto>;
