import { z } from 'zod';

export const CreateRoleDto = z.object({
  name: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z_]+$/, 'Role name must be lowercase letters and underscores only')
    .trim(),
  description: z.string().max(500).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export const UpdateRoleDto = z.object({
  name: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z_]+$/, 'Role name must be lowercase letters and underscores only')
    .trim()
    .optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export const AssignPermissionsDto = z.object({
  permissionIds: z.array(z.string().uuid()).min(1, 'At least one permission ID is required'),
});

export const PaginationQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
});

export type CreateRoleInput = z.infer<typeof CreateRoleDto>;
export type UpdateRoleInput = z.infer<typeof UpdateRoleDto>;
export type AssignPermissionsInput = z.infer<typeof AssignPermissionsDto>;
export type PaginationQueryInput = z.infer<typeof PaginationQueryDto>;
