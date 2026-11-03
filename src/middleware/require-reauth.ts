import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@infrastructure/database/index';
import { ForbiddenError, UnauthorizedError } from '@core/errors/index';
import { config } from '@config/index';

export const REAUTH_REQUIRED_MESSAGE = 'Recent re-authentication required';

/**
 * Allows the request only if the session confirmed its password within the freshness window
 * (`POST /auth/reauthenticate`). Place it after `authenticate` and the permission guard, on
 * routes the contract marks "recent reauthentication required". Responds 403.
 */
export async function requireRecentReauth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sid = req.user?.sid;
    if (!req.user || !sid) return next(new UnauthorizedError('Unauthorized'));

    const session = await prisma.refreshToken.findFirst({
      where: { userId: req.user.sub, familyId: sid, used: false, revokedAt: null },
      select: { reauthenticatedAt: true },
    });
    const windowMs = config.security.reauthWindowMinutes * 60 * 1000;
    const fresh =
      session?.reauthenticatedAt && Date.now() - session.reauthenticatedAt.getTime() <= windowMs;

    if (!fresh) return next(new ForbiddenError(REAUTH_REQUIRED_MESSAGE));
    next();
  } catch (err) {
    next(err);
  }
}
