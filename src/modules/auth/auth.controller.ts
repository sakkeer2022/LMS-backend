import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { RegisterDto, LoginDto } from './auth.dto.js';
import * as AuthService from './auth.service.js';
import { successResponse } from '@core/response/index';
import { UnauthorizedError } from '@core/errors/index';
import { config } from '@config/index';
import { generateDeviceFingerprint } from '@core/security/device';
import { verifyRefreshToken } from '@core/security/jwt';

function setTokenCookies(
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
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (matching typical refresh token TTL)
    path: '/api/v1/auth', // Scope to auth routes for better security
  });
}

function clearTokenCookies(res: Response): void {
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/api/v1/auth' });
}

function getRequestContext(req: Request): AuthService.SessionContext {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || 'unknown-ip',
    userAgent: req.headers['user-agent'] || 'unknown-agent',
    deviceFingerprint: generateDeviceFingerprint(req),
  };
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = RegisterDto.parse(req.body);
    const context = getRequestContext(req);
    const result = await AuthService.register(dto, context);

    setTokenCookies(res, result.tokens);
    res.status(201).json(successResponse({ user: result.user }, 'Registration successful'));
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = LoginDto.parse(req.body);
    const context = getRequestContext(req);
    const result = await AuthService.login(dto, context);

    setTokenCookies(res, result.tokens);
    res.json(successResponse({ user: result.user }, 'Login successful'));
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token is required');
    }

    const context = getRequestContext(req);
    const tokens = await AuthService.refresh(refreshToken, context);
    setTokenCookies(res, tokens);

    res.json(successResponse(null, 'Token refreshed'));
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    let accessToken = req.cookies?.accessToken;
    if (!accessToken) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        accessToken = authHeader.slice(7);
      }
    }

    if (refreshToken || accessToken) {
      await AuthService.logout(refreshToken, accessToken);
    }

    clearTokenCookies(res);
    res.json(successResponse(null, 'Logged out successfully'));
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = (req as Request & { user?: { sub: string } }).user?.sub;
    if (!userId) {
      next(new UnauthorizedError('Unauthorized'));
      return;
    }
    const profile = await AuthService.getMe(userId);
    res.json(successResponse(profile));
  } catch (err) {
    next(err);
  }
}

export function getCsrfToken(_req: Request, res: Response, next: NextFunction): void {
  try {
    const csrfToken = crypto.randomUUID();

    res.cookie('_csrf', csrfToken, {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'strict',
      signed: true,
    });

    res.json(successResponse({ csrfToken }, 'CSRF token generated'));
  } catch (err) {
    next(err);
  }
}

// ── Active Sessions Controls ──────────────────────────────────────
export async function getSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = (req as Request & { user?: { sub: string } }).user?.sub;
    if (!userId) {
      throw new UnauthorizedError('Unauthorized');
    }
    const sessions = await AuthService.listSessions(userId);
    res.json(successResponse(sessions));
  } catch (err) {
    next(err);
  }
}

export async function revokeSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = (req as Request & { user?: { sub: string } }).user?.sub;
    if (!userId) {
      throw new UnauthorizedError('Unauthorized');
    }
    const { jti } = req.params;
    if (typeof jti !== 'string') {
      throw new UnauthorizedError('Invalid JTI');
    }
    await AuthService.revokeSession(userId, jti);
    res.json(successResponse(null, 'Session revoked'));
  } catch (err) {
    next(err);
  }
}

export async function revokeOtherSessions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = (req as Request & { user?: { sub: string } }).user?.sub;
    if (!userId) {
      throw new UnauthorizedError('Unauthorized');
    }

    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    let currentJti = 'none';
    if (refreshToken && typeof refreshToken === 'string') {
      try {
        const decoded = verifyRefreshToken(refreshToken);
        currentJti = decoded.jti || 'none';
      } catch {
        // ignore invalid token
      }
    }

    await AuthService.revokeOtherSessions(userId, currentJti);
    res.json(successResponse(null, 'Other sessions revoked'));
  } catch (err) {
    next(err);
  }
}
