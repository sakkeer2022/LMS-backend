import { z } from 'zod';
import { PaginationQueryDto } from '@modules/roles/roles.dto.js';

export const MAX_WINDOW_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

const text = z.string().min(1).max(100);
const instant = z.string().datetime().pipe(z.coerce.date());

/** Query of GET /audit (contract `listAuditEvents`): UTC window, from inclusive and to exclusive. */
export const AuditLogQueryDto = PaginationQueryDto.omit({ search: true })
  .extend({
    actorId: z.string().uuid().optional(),
    action: text.optional(),
    entity: text.optional(),
    resourceId: text.optional(),
    from: instant.optional(),
    to: instant.optional(),
  })
  .strict()
  .superRefine(({ from, to }, ctx) => {
    if (!from || !to) return;
    if (from >= to)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be after from' });
    else if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS)
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `The window between from and to is at most ${MAX_WINDOW_DAYS} days`,
      });
  });

export type AuditLogQueryInput = z.infer<typeof AuditLogQueryDto>;
