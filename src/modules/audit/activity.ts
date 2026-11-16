import type { Request } from 'express';
import { auditContextFrom } from '@middleware/audit.middleware';
import { logger } from '@core/logger/index';
import { logAction, type LogActionParams } from './audit.service.js';

export interface ActivityInput {
  /** The signed-in request, so the entry records who did it, from where and under which trace. */
  actor: Request;
  /** Dotted verb, e.g. `payout.approve`. Use `<entity>.<verb>`; the viewer filters on it. */
  action: string;
  /** What was touched, e.g. `payout`. */
  entityType: string;
  entityId?: string;
  /** State before the change (omit for creates). Secrets are redacted when the log is read. */
  before?: Record<string, unknown> | null;
  /** State after the change (omit for deletes). */
  after?: Record<string, unknown> | null;
}

/**
 * Records one activity entry in the append-only audit log, for any module, in one line:
 *
 *   await logActivity({ actor: req, action: 'payout.approve', entityType: 'payout', entityId: id, before, after });
 *
 * The entry appears in Activity log (needs `audit.read`). It is hash-chained and cannot be edited or
 * deleted through the API. A failed write is logged and swallowed so it never breaks the user's action;
 * for changes that must not happen unaudited, call `logAction` inside your own transaction instead.
 */
export async function logActivity(input: ActivityInput): Promise<void> {
  const params: LogActionParams = {
    ...auditContextFrom(input.actor),
    severity: 'INFO',
    entity: input.entityType,
    action: input.action,
    resourceId: input.entityId ?? null,
    previousValue: input.before ?? null,
    newValue: input.after ?? null,
  };
  try {
    await logAction(params);
  } catch (err) {
    logger.error({ err, action: input.action }, 'Failed to write activity log');
  }
}
