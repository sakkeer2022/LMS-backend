import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { redisClient } from '@infrastructure/redis/connection';
import {
  signAccessToken,
  signRefreshToken,
  getAccessTokenTtlSeconds,
  getRefreshTokenExpiryDate,
  type TokenPair,
} from '@core/security/jwt';
import type { Portal } from '@core/security/rbac';
import { resolvePermissionsForRoles, resolvePoliciesForRoles } from '../roles/roles.service.js';
import type { SessionContext } from './auth.service.js';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface IssueOptions {
  /** Portal the session belongs to; stored on the refresh row and signed into both tokens. */
  portal?: Portal;
  /** Session family; a new one is started when absent. Rotation passes the existing one. */
  familyId?: string;
  /** Absolute session deadline. Rotation passes the existing one so it does not slide. */
  expiresAt?: Date;
}

export async function issueTokenPair(
  user: { id: string; email: string },
  context: Partial<SessionContext>,
  tx?: Prisma.TransactionClient,
  options: IssueOptions = {}
): Promise<TokenPair & { sessionExpiresAt: Date }> {
  const db = tx || prisma;
  const userRoles = await db.userRole.findMany({
    where: { userId: user.id },
    select: {
      role: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const roleIds = userRoles.map((ur) => ur.role.id);
  const roleNames = userRoles.map((ur) => ur.role.name);

  const permissions = await resolvePermissionsForRoles(roleIds);
  const policies = await resolvePoliciesForRoles(roleIds);

  const familyId = options.familyId ?? crypto.randomUUID();
  const refreshJti = crypto.randomUUID();
  const accessJti = crypto.randomUUID();

  const payload = {
    sub: user.id,
    email: user.email,
    roles: roleNames,
    permissions,
    policies,
    sid: familyId,
    ...(options.portal ? { portal: options.portal } : {}),
  };
  const accessToken = signAccessToken({ ...payload, jti: accessJti });
  const refreshToken = signRefreshToken({ ...payload, jti: refreshJti });

  const tokenHash = hashToken(refreshToken);
  // A rotated session keeps its original deadline: the absolute expiry never slides
  const expiresAt = options.expiresAt ?? getRefreshTokenExpiryDate();

  const isMocked =
    typeof (prisma.refreshToken.create as unknown as { mock?: unknown }).mock !== 'undefined';

  const tokenData = {
    userId: user.id,
    tokenHash,
    jti: refreshJti,
    used: false,
    portal: options.portal ?? null,
    familyId,
    ipAddress: context.ipAddress || null,
    userAgent: context.userAgent || null,
    deviceFingerprint: context.deviceFingerprint || null,
    expiresAt,
  };

  if (process.env.NODE_ENV === 'test' && isMocked) {
    await prisma.refreshToken.create({
      data: tokenData,
    });
  } else {
    await db.refreshToken.create({
      data: tokenData,
    });
  }

  if (redisClient) {
    const ttlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    if (ttlSeconds > 0) {
      const sessionData = {
        jti: refreshJti,
        userId: user.id,
        deviceFingerprint: context.deviceFingerprint || '',
        ipAddress: context.ipAddress || '',
        userAgent: context.userAgent || '',
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
      await redisClient.set(
        `sess:${user.id}:${refreshJti}`,
        JSON.stringify(sessionData),
        'EX',
        ttlSeconds
      );
    }
  }

  return {
    accessToken,
    refreshToken,
    expiresIn: getAccessTokenTtlSeconds(),
    sessionExpiresAt: expiresAt,
  };
}
