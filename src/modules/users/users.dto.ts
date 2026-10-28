import { z } from 'zod';
import { PaginationQueryDto } from '@modules/roles/roles.dto.js';

export const CreateUserDto = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
  isActive: z.boolean().optional(),
});

export const UpdateUserDto = z.object({
  firstName: z.string().min(1).max(100).trim().optional(),
  lastName: z.string().min(1).max(100).trim().optional(),
  isActive: z.boolean().optional(),
});

export const AssignRolesDto = z.object({
  roleIds: z.array(z.string().uuid()).min(1, 'At least one role ID is required'),
});

// Re-export pagination
export { PaginationQueryDto };

export type CreateUserInput = z.infer<typeof CreateUserDto>;
export type UpdateUserInput = z.infer<typeof UpdateUserDto>;
export type AssignRolesInput = z.infer<typeof AssignRolesDto>;
