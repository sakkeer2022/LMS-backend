import { z } from 'zod';
import { paginationQuerySchema, queryBoolean } from '@shared/validation/index';

export const ListStudentsQueryDto = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  country: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase())
    .optional(),
  minor: queryBoolean.optional(),
  consent: z.enum(['signed', 'missing', 'not_required']).optional(),
});

export const StudentParamsDto = z.strictObject({ studentId: z.uuid() });

export type ListStudentsQuery = z.infer<typeof ListStudentsQueryDto>;
