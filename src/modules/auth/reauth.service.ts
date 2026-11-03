import bcrypt from 'bcrypt';
import { prisma } from '@infrastructure/database/index';
import { TooManyRequestsError, UnauthorizedError } from '@core/errors/index';
import { config } from '@config/index';
import { logAction, type AuditContext } from '../audit/audit.service.js';

export interface ReauthResult {
  reauthenticatedUntil: Date;
}

/**
 * Confirms the signed-in user's password and marks their current session as freshly
 * re-authenticated. The mark belongs to the session (nothing transferable is returned) and
 * survives token rotation. A wrong password counts toward the account lockout and never
 * extends freshness.
 */
export async function reauthenticate(
  userId: string,
  sessionId: string,
  password: string,
  audit: AuditContext
): Promise<ReauthResult> {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user || !user.isActive) throw new UnauthorizedError('Unauthorized');
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new TooManyRequestsError('Too many failed attempts. Please try again later.');
  }

  if (!(await bcrypt.compare(password, user.passwordHash))) {
    const attempts = user.failedLoginAttempts + 1;
    const locked = attempts >= config.security.maxFailedLogins;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        ...(locked && {
          lockedUntil: new Date(Date.now() + config.security.lockoutDurationMinutes * 60 * 1000),
        }),
      },
    });
    await logAction({
      ...audit,
      actorId: user.id,
      severity: 'SECURITY',
      entity: 'auth',
      action: 'reauth.failed',
      resourceId: sessionId,
    });
    throw new UnauthorizedError('Invalid password');
  }

  const now = new Date();
  const marked = await prisma.refreshToken.updateMany({
    where: { userId, familyId: sessionId, used: false, revokedAt: null },
    data: { reauthenticatedAt: now },
  });
  if (marked.count === 0) throw new UnauthorizedError('Session has ended');

  if (user.failedLoginAttempts > 0) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0 } });
  }
  await logAction({
    ...audit,
    actorId: user.id,
    severity: 'INFO',
    entity: 'auth',
    action: 'reauth.success',
    resourceId: sessionId,
  });

  return {
    reauthenticatedUntil: new Date(now.getTime() + config.security.reauthWindowMinutes * 60 * 1000),
  };
}
