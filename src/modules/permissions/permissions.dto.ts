import { z } from 'zod';
import { PaginationQueryDto } from '@modules/roles/roles.dto.js';

export const PermissionActionEnum = z.enum(['create', 'read', 'update', 'delete', 'manage']);

export const CreatePermissionDto = z.object({
  name: z
    .string()
    .min(3)
    .max(150)
    .regex(/^[a-z_]+:[a-z_]+$/, 'Format must be resource:action (e.g. users:read)')
    .trim(),
  resource: z.string().min(2).max(100).trim(),
  action: PermissionActionEnum,
  description: z.string().max(500).optional(),
});

export const UpdatePermissionDto = z.object({
  description: z.string().max(500).optional(),
  // Name, resource, and action are usually immutable once created to avoid breaking code logic,
  // so we only allow updating the description.
});

// Re-export the pagination DTO for convenience
export { PaginationQueryDto };

export type CreatePermissionInput = z.infer<typeof CreatePermissionDto>;
export type UpdatePermissionInput = z.infer<typeof UpdatePermissionDto>;
