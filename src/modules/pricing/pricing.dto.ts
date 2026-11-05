import { z } from 'zod';
import { paginationQuerySchema, queryBoolean, uuidParams } from '@shared/validation/index';

// Pre-GST session price in paise: more than 0, at most INR 10,00,000
const sessionPricePaise = z.number().int().min(1).max(100000000);
const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const revision = z.number().int().min(1);

function windowIsValid(value: { effectiveFrom?: Date; effectiveTo?: Date | null }): boolean {
  return !value.effectiveFrom || !value.effectiveTo || value.effectiveTo > value.effectiveFrom;
}
const windowMessage = { message: 'effectiveTo must be after effectiveFrom', path: ['effectiveTo'] };

export const PriceIdParamsDto = uuidParams('priceId');

export const ListPriceRulesQueryDto = paginationQuerySchema
  .extend({
    facultyId: z.uuid().optional(),
    defaultOnly: queryBoolean.optional(),
    categoryId: z.uuid().optional(),
    boardId: z.uuid().optional(),
    subjectId: z.uuid().optional(),
    levelId: z.uuid().optional(),
    isActive: queryBoolean.optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const CreatePriceRuleDto = z
  .object({
    curriculumId: z.uuid(),
    // faculty_profiles.id; null = default price for the curriculum
    facultyId: z.uuid().nullable(),
    sessionPricePaise,
    effectiveFrom: timestamp.optional(),
    effectiveTo: timestamp.nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine(windowIsValid, windowMessage);

export const UpdatePriceRuleDto = z
  .object({
    sessionPricePaise: sessionPricePaise.optional(),
    effectiveFrom: timestamp.optional(),
    effectiveTo: timestamp.nullable().optional(),
    isActive: z.boolean().optional(),
    expectedRevision: revision,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, {
    message: 'Provide at least one field to change',
  })
  .refine(windowIsValid, windowMessage);

/** Screen 29b: save several inline price edits together. */
export const BulkUpdatePriceRulesDto = z
  .object({
    changes: z
      .array(z.object({ id: z.uuid(), sessionPricePaise, expectedRevision: revision }).strict())
      .min(1)
      .max(200)
      .refine((changes) => new Set(changes.map((c) => c.id)).size === changes.length, {
        message: 'Each price rule may appear only once',
      }),
  })
  .strict();

export const ResolvePriceQueryDto = z
  .object({
    curriculumId: z.uuid(),
    facultyId: z.uuid().optional(),
    at: timestamp.optional(),
  })
  .strict();

const quoteFaculty = z.uuid().nullable().optional();
const QuoteByCurriculum = z.object({ curriculumId: z.uuid(), facultyId: quoteFaculty }).strict();
const QuoteByCombination = z
  .object({
    categoryId: z.uuid(),
    // Omitted = every board; null = offerings without a board
    boardId: z.uuid().nullable().optional(),
    subjectId: z.uuid(),
    levelId: z.uuid(),
    facultyId: quoteFaculty,
  })
  .strict();

export const QuotePricesDto = z
  .object({
    items: z
      .array(z.union([QuoteByCurriculum, QuoteByCombination]))
      .min(1)
      .max(50),
  })
  .strict();

export type ListPriceRulesQuery = z.infer<typeof ListPriceRulesQueryDto>;
export type CreatePriceRuleInput = z.infer<typeof CreatePriceRuleDto>;
export type UpdatePriceRuleInput = z.infer<typeof UpdatePriceRuleDto>;
export type BulkUpdatePriceRulesInput = z.infer<typeof BulkUpdatePriceRulesDto>;
export type ResolvePriceQuery = z.infer<typeof ResolvePriceQueryDto>;
export type QuotePricesInput = z.infer<typeof QuotePricesDto>;
