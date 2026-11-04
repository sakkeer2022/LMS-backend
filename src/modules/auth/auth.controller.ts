import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import * as AuthService from './auth.service.js';
import * as SessionService from './session.service.js';
import { loadContractUser } from './contract-user.js';
import * as ReauthService from './reauth.service.js';
import { ReauthenticateDto } from './auth.dto.js';
import { auditContextFrom } from '@middleware/audit.middleware';
import { paginationQuerySchema, uuidParams } from '@shared/validation/index';
import { successResponse } from '@core/response/index';
import { UnauthorizedError, ValidationError } from '@core/errors/index';
import { config } from '@config/index';
import { setTokenCookies, clearTokenCookies, getRequestContext } from './session-cookies.js';

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Cookie only: a token in the body is never accepted
    if (req.body?.refreshToken !== undefined) {
      throw new ValidationError('The refresh token is accepted only as a cookie');
    }
    const refreshToken: unknown = req.cookies?.refreshToken;
    if (typeof refreshToken !== 'string' || refreshToken === '') {
      throw new UnauthorizedError('Refresh token is required');
    }

    const result = await SessionService.refresh(refreshToken, getRequestContext(req));
    setTokenCookies(res, result.tokens, {
      persistent: result.remember,
      expiresAt: result.sessionExpiresAt,
    });

    res.set('Cache-Control', 'no-store');
    res.json(
      successResponse(
        { accessExpiresAt: result.accessExpiresAt, sessionExpiresAt: result.sessionExpiresAt },
        'Token refreshed'
      )
    );
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
    const userId = req.user?.sub;
    if (!userId) {
      next(new UnauthorizedError('Unauthorized'));
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.json(successResponse(await loadContractUser(userId)));
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
    if (!req.user) throw new UnauthorizedError('Unauthorized');
    const query = paginationQuerySchema.parse(req.query);
    const { sessions, meta } = await SessionService.listSessions(req.user.sub, req.user.sid, query);
    res.set('Cache-Control', 'no-store');
    res.json(successResponse(sessions, 'Success', meta));
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
    if (!req.user) throw new UnauthorizedError('Unauthorized');
    const { jti } = uuidParams('jti').parse(req.params);
    await SessionService.revokeSession(req.user.sub, jti, auditContextFrom(req));
    // Revoking the session in use signs this browser out
    if (jti === req.user.sid) clearTokenCookies(res);
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
    if (!req.user?.sid) throw new UnauthorizedError('Unauthorized');
    await SessionService.revokeOtherSessions(req.user.sub, req.user.sid, auditContextFrom(req));
    res.json(successResponse(null, 'Other sessions revoked'));
  } catch (err) {
    next(err);
  }
}

export async function reauthenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user?.sid) throw new UnauthorizedError('Unauthorized');
    const { password } = ReauthenticateDto.parse(req.body);
    const result = await ReauthService.reauthenticate(
      req.user.sub,
      req.user.sid,
      password,
      auditContextFrom(req)
    );
    res.set('Cache-Control', 'no-store');
    res.json(successResponse(result, 'Re-authenticated'));
  } catch (err) {
    next(err);
  }
}
