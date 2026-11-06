import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, base64url: 43 URL-safe characters, 256 bits of entropy. */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

/** SHA-256 hex of a token; only this is stored. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Onboarding link for a token: the faculty app's /onboarding page (screens 43b-43e). */
export function buildInviteUrl(appBaseUrl: string, token: string): string {
  const url = new URL('/onboarding', `${appBaseUrl.replace(/\/+$/, '')}/`);
  url.searchParams.set('token', token);
  return url.toString();
}

/** Expiry for an invitation created at `now`. */
export function inviteExpiry(now: Date, ttlHours: number): Date {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}
