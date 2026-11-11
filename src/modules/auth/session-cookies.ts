import type { Request, Response } from 'express';
import ms from 'ms';
import { config } from '@config/index';
import { generateDeviceFingerprint } from '@core/security/device';
import { cookieName } from '@core/security/portal-cookies';
import type { Portal } from '@core/security/rbac';
import type { SessionContext } from './auth.service.js';

export function setTokenCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number },
  // Without it the refresh cookie lasts the configured refresh lifetime (registration, legacy callers)
  session?: { persistent: boolean; expiresAt: Date },
  portal?: Portal
): void {
  const cookieOptions = {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'strict' as const,
  };

  res.cookie(cookieName('accessToken', portal), tokens.accessToken, {
    ...cookieOptions,
    maxAge: tokens.expiresIn * 1000,
  });

  res.cookie(cookieName('refreshToken', portal), tokens.refreshToken, {
    ...cookieOptions,
    // A sign-in without "keep me signed in" gets a browser-session cookie (no maxAge)
    ...(session
      ? session.persistent && { maxAge: Math.max(0, session.expiresAt.getTime() - Date.now()) }
      : { maxAge: ms(config.jwt.refreshExpiresIn as ms.StringValue) }),
    path: '/api/v1/auth', // Scope to auth routes for better security
  });
}

export function clearTokenCookies(res: Response, portal?: Portal): void {
  res.clearCookie(cookieName('accessToken', portal), { path: '/' });
  res.clearCookie(cookieName('refreshToken', portal), { path: '/api/v1/auth' });
}

export function getRequestContext(req: Request): SessionContext {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || 'unknown-ip',
    userAgent: req.headers['user-agent'] || 'unknown-agent',
    deviceFingerprint: generateDeviceFingerprint(req),
  };
}
