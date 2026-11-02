import type { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { redisClient } from '@infrastructure/redis/connection';
import { NotFoundError, UnauthorizedError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { verifyRefreshToken, getAccessTokenTtlSeconds } from '@core/security/jwt';
import { PORTALS, PORTAL_ROLES, type Portal } from '@core/security/rbac';
import { markSessionRevoked } from '@core/security/session-revocation';
import { buildPaginationMeta } from '@shared/types/pagination';
import type { PaginationQuery } from '@shared/validation/index';
import { logAction, type AuditContext } from '../audit/audit.service.js';
import { mockImpossibleTravelSuspensions, type SessionContext } from './auth.service.js';
import { hashToken, issueTokenPair } from './session.js';

const isPortal = (value: string | null): value is Portal =>
  value !== null && (PORTALS as readonly string[]).includes(value);

const REAUTH_REQUIRED_MESSAGE = 'Session expired. Please log in again.';

// ── Refresh ──────────────────────────────────────────────────────

export interface RefreshResult {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
  remember: boolean;
  accessExpiresAt: Date;
  sessionExpiresAt: Date;
}

async function assertNotSuspended(userId: string): Promise<void> {
  const suspended = redisClient
    ? (await redisClient.get(`impossible_travel:${userId}`)) !== null
    : mockImpossibleTravelSuspensions.has(userId);
  if (!suspended) return;
  logger.warn(
    { type: 'security', event: 'REFRESH_BLOCKED_IMPOSSIBLE_TRAVEL', userId },
    'Refresh token request blocked due to active impossible travel suspension'
  );
  throw new UnauthorizedError(
    'Session suspended: unusual login location detected. Please verify your identity.'
  );
}

type Rotation =
  | { kind: 'rotated'; tokens: Awaited<ReturnType<typeof issueTokenPair>> }
  | { kind: 'reused'; userId: string; familyId: string | null; jti: string | null };

/**
 * Rotates a refresh token. The session keeps its original deadline (`sessionExpiresAt` never
 * slides), portal and family. The account, its status and its portal role are checked again.
 * Reuse of an already-used token revokes the whole session family.
 */
export async function refresh(
  rawRefreshToken: string,
  context: SessionContext
): Promise<RefreshResult> {
  let payload: ReturnType<typeof verifyRefreshToken>;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
  await assertNotSuspended(payload.sub);

  const tokenHash = hashToken(rawRefreshToken);

  const outcome = await prisma.$transaction(async (tx): Promise<Rotation> => {
    const stored = await tx.refreshToken.findFirst({ where: { userId: payload.sub, tokenHash } });
    if (!stored || stored.revokedAt) throw new UnauthorizedError('Refresh token has been revoked');

    if (stored.used) {
      return { kind: 'reused', userId: payload.sub, familyId: stored.familyId, jti: stored.jti };
    }

    if (stored.expiresAt < new Date()) throw new UnauthorizedError(REAUTH_REQUIRED_MESSAGE);

    if (stored.deviceFingerprint && stored.deviceFingerprint !== context.deviceFingerprint) {
      logger.warn(
        { type: 'security', event: 'DEVICE_CHANGE_DETECTED', userId: payload.sub, jti: stored.jti },
        'Device change detected during token refresh'
      );
      throw new UnauthorizedError('Device mismatch. Please log in again.');
    }

    const user = await tx.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      include: { roles: { select: { role: { select: { name: true } } } } },
    });
    if (
      !user ||
      !user.isActive ||
      user.status === 'INACTIVE' ||
      user.status === 'SUSPENDED' ||
      !isPortal(stored.portal) ||
      !user.roles.some((ur) => PORTAL_ROLES[stored.portal as Portal].includes(ur.role.name))
    ) {
      throw new UnauthorizedError(REAUTH_REQUIRED_MESSAGE);
    }

    await tx.refreshToken.update({ where: { id: stored.id }, data: { used: true } });
    if (redisClient && stored.jti) await redisClient.del(`sess:${payload.sub}:${stored.jti}`);

    const tokens = await issueTokenPair(user, context, tx, {
      portal: stored.portal,
      familyId: stored.familyId ?? undefined,
      expiresAt: stored.expiresAt,
      remember: payload.rm === true,
      reauthenticatedAt: stored.reauthenticatedAt,
    });
    return { kind: 'rotated', tokens };
  });

  if (outcome.kind === 'reused') {
    // Outside the transaction above, so the revocation is committed even though we then fail
    logger.error(
      { type: 'security', event: 'TOKEN_THEFT_DETECTED', userId: outcome.userId, jti: outcome.jti },
      'Refresh token reuse detected. Revoking the session.'
    );
    await revokeFamily(outcome.userId, outcome.familyId);
    await logAction({
      actorId: outcome.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      deviceFingerprint: context.deviceFingerprint,
      severity: 'SECURITY',
      entity: 'auth',
      action: 'session.reuse_detected',
      resourceId: outcome.familyId,
    });
    throw new UnauthorizedError('Session hijacked. Please login again.');
  }

  const { sessionExpiresAt, ...tokens } = outcome.tokens;
  return {
    tokens,
    remember: payload.rm === true,
    accessExpiresAt: new Date(Date.now() + getAccessTokenTtlSeconds() * 1000),
    sessionExpiresAt,
  };
}

// ── Session families ─────────────────────────────────────────────

/** Revokes a session family: refresh tokens and, at once, its access tokens. */
async function revokeFamily(userId: string, familyId: string | null): Promise<void> {
  const where: Prisma.RefreshTokenWhereInput = familyId ? { userId, familyId } : { userId };
  const rows = await prisma.refreshToken.findMany({ where, select: { jti: true } });
  await prisma.refreshToken.updateMany({
    where: { ...where, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (familyId) await markSessionRevoked(familyId);
  if (redisClient) {
    for (const row of rows) if (row.jti) await redisClient.del(`sess:${userId}:${row.jti}`);
  }
}

export interface SessionView {
  jti: string;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
  userAgent?: string;
}

/** The user's live session families, newest first. `jti` is the family id: stable across rotation. */
export async function listSessions(
  userId: string,
  currentFamilyId: string | undefined,
  query: PaginationQuery
): Promise<{ sessions: SessionView[]; meta: ReturnType<typeof buildPaginationMeta> }> {
  const live: Prisma.RefreshTokenWhereInput = {
    userId,
    used: false,
    revokedAt: null,
    familyId: { not: null },
    expiresAt: { gt: new Date() },
  };
  const [rows, total] = await Promise.all([
    prisma.refreshToken.findMany({
      where: live,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.refreshToken.count({ where: live }),
  ]);

  const created = await prisma.refreshToken.groupBy({
    by: ['familyId'],
    where: { userId, familyId: { in: rows.map((r) => r.familyId as string) } },
    _min: { createdAt: true },
  });
  const startedAt = new Map(created.map((c) => [c.familyId, c._min.createdAt]));

  return {
    sessions: rows.map((row) => ({
      jti: row.familyId as string,
      createdAt: startedAt.get(row.familyId) ?? row.createdAt,
      expiresAt: row.expiresAt,
      isCurrent: row.familyId === currentFamilyId,
      ...(row.userAgent && { userAgent: row.userAgent.slice(0, 512) }),
    })),
    meta: buildPaginationMeta(total, query.page, query.limit),
  };
}

/** Revokes one of the user's own sessions; another user's session is a 404. */
export async function revokeSession(
  userId: string,
  familyId: string,
  audit: AuditContext
): Promise<void> {
  const exists = await prisma.refreshToken.findFirst({
    where: { userId, familyId, revokedAt: null },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError('Session');

  await revokeFamily(userId, familyId);
  await logAction({
    ...audit,
    actorId: userId,
    severity: 'SECURITY',
    entity: 'auth',
    action: 'session.revoked',
    resourceId: familyId,
  });
}

/** Revokes every other session family of the user and leaves the current one active. */
export async function revokeOtherSessions(
  userId: string,
  currentFamilyId: string,
  audit: AuditContext
): Promise<void> {
  const others = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, familyId: { not: null, notIn: [currentFamilyId] } },
    select: { familyId: true },
    distinct: ['familyId'],
  });
  for (const { familyId } of others) await revokeFamily(userId, familyId);
  await logAction({
    ...audit,
    actorId: userId,
    severity: 'SECURITY',
    entity: 'auth',
    action: 'session.revoked_others',
    resourceId: currentFamilyId,
    newValue: { revoked: others.length },
  });
}
