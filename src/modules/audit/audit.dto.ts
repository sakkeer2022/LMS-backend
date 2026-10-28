import { z } from 'zod';
import { PaginationQueryDto } from '@modules/roles/roles.dto.js';

export const AuditLogQueryDto = PaginationQueryDto.extend({
  userId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().optional(),
  resource: z.string().optional(),
  entity: z.string().optional(),
  resourceId: z.string().optional(),
});

export type AuditLogQueryInput = z.infer<typeof AuditLogQueryDto>;
