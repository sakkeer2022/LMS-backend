import { z } from 'zod';

export const AdminUserParamsDto = z.object({
  id: z.string().uuid('Invalid user ID format'),
});

export const ToggleUserStatusBodyDto = z.object({
  isActive: z.boolean({
    message: 'isActive must be a boolean',
  }),
});

export type AdminUserParamsInput = z.infer<typeof AdminUserParamsDto>;
export type ToggleUserStatusBodyInput = z.infer<typeof ToggleUserStatusBodyDto>;
