import type { Request } from 'express';
import { PORTALS, type Portal } from './rbac.js';

/**
 * The portals share one browser cookie jar on a shared host (cookies ignore ports), so each portal's
 * frontend names itself in `x-portal` and its cookies carry that name. Without the header the original
 * unscoped names are used (API clients, tests).
 */
export function requestPortal(req: Request): Portal | undefined {
  const value = req.headers['x-portal'];
  return typeof value === 'string' && (PORTALS as readonly string[]).includes(value)
    ? (value as Portal)
    : undefined;
}

export const cookieName = (base: string, portal?: Portal): string =>
  portal ? `${portal}_${base}` : base;
