import { z } from 'zod';
import { PaginationQueryDto } from '@modules/roles/roles.dto.js';

export const CreateNotificationDto = z.object({
  name: z.string().min(2).max(100).trim(),
  description: z.string().max(500).optional(),
});

export const UpdateNotificationDto = CreateNotificationDto.partial();

export { PaginationQueryDto };
export type CreateNotificationInput = z.infer<typeof CreateNotificationDto>;
export type UpdateNotificationInput = z.infer<typeof UpdateNotificationDto>;
