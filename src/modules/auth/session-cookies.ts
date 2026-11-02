import type { Request, Response } from 'express';
import ms from 'ms';
import { config } from '@config/index';
import { generateDeviceFingerprint } from '@core/security/device';
import type { SessionContext } from './auth.service.js';

export function setTokenCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number }
): void {
  const cookieOptions = {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'strict' as const,
  };

  res.cookie('accessToken', tokens.accessToken, {
    ...cookieOptions,
    maxAge: tokens.expiresIn * 1000,
  });

  res.cookie('refreshToken', tokens.refreshToken, {
    ...cookieOptions,
    maxAge: ms(config.jwt.refreshExpiresIn as ms.StringValue),
    path: '/api/v1/auth', // Scope to auth routes for better security
  });
}

export function clearTokenCookies(res: Response): void {
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/api/v1/auth' });
}

export function getRequestContext(req: Request): SessionContext {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || 'unknown-ip',
    userAgent: req.headers['user-agent'] || 'unknown-agent',
    deviceFingerprint: generateDeviceFingerprint(req),
  };
}
