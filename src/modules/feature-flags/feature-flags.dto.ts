import { z } from 'zod';
import { PaginationQueryDto } from '@modules/roles/roles.dto.js';

export const CreateFeatureFlagDto = z.object({
  name: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9_]+$/, 'Format must be snake_case (e.g. new_dashboard)')
    .trim(),
  description: z.string().max(500).optional(),
  isEnabled: z.boolean().default(false),
  rolloutPercentage: z.number().int().min(0).max(100).default(0),
  conditions: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateFeatureFlagDto = z.object({
  name: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9_]+$/, 'Format must be snake_case (e.g. new_dashboard)')
    .trim()
    .optional(),
  description: z.string().max(500).optional(),
  isEnabled: z.boolean().optional(),
  rolloutPercentage: z.number().int().min(0).max(100).optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
});

export { PaginationQueryDto };

export type CreateFeatureFlagInput = z.infer<typeof CreateFeatureFlagDto>;
export type UpdateFeatureFlagInput = z.infer<typeof UpdateFeatureFlagDto>;
