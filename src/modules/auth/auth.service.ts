import bcrypt from 'bcrypt';
import { prisma } from '@infrastructure/database/index';
import type { Prisma } from '@prisma/client';
import { verifyAccessToken, verifyRefreshToken, type TokenPair } from '@core/security/jwt';
import { redisClient } from '@infrastructure/redis/connection';
import { ConflictError, UnauthorizedError, NotFoundError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { config } from '@config/index';
import type { RegisterInput, LoginInput } from './auth.dto.js';
import { issueTokenPair, hashToken } from './session.js';
import { resolveCountry, detectImpossibleTravel } from '@core/security/travel';

const BCRYPT_ROUNDS = 12;

export const mockImpossibleTravelSuspensions = new Set<string>();

// ── Public profile shape ──────────────────────────────────────────
export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roles: Array<{
    id: string;
    name: string;
    permissions: Array<{ name: string }>;
  }>;
}

// ── Service ──────────────────────────────────────────────────────
export interface SessionContext {
  ipAddress: string;
  userAgent: string;
  deviceFingerprint: string;
}

export async function register(
  dto: RegisterInput,
  context: SessionContext
): Promise<{ user: UserProfile; tokens: TokenPair }> {
  const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });
    if (existing) throw new ConflictError('Email is already in use');

    const user = await tx.user.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
      },
    });

    const tokens = await issueTokenPair(user, context, tx);
    const profile = await _buildProfile(user.id, tx);

    return { user: profile, tokens };
  });
}

/**
 * Resolves the login country and flags impossible travel against the previous login, which
 * suspends session refresh for 24 hours. Returns the country to store as the last login country.
 */
export async function assessLoginLocation(
  user: {
    id: string;
    email: string;
    lastLoginAt: Date | null;
    lastLoginIp: string | null;
    lastLoginCountry: string | null;
  },
  context: SessionContext
): Promise<string> {
  // Resolve current country code
  const newLoginCountry = resolveCountry(context.ipAddress) || 'US';

  // Perform impossible travel calculation if previous login info exists
  if (user.lastLoginAt && user.lastLoginIp && user.lastLoginCountry) {
    const result = detectImpossibleTravel({
      lastLoginIp: user.lastLoginIp,
      lastLoginCountry: user.lastLoginCountry,
      lastLoginAt: user.lastLoginAt,
      newLoginIp: context.ipAddress,
      newLoginCountry,
      newLoginAt: new Date(),
    });

    if (result.suspicious) {
      logger.error(
        {
          type: 'security',
          event: 'IMPOSSIBLE_TRAVEL_DETECTED',
          userId: user.id,
          email: user.email,
          lastLoginIp: user.lastLoginIp,
          lastLoginCountry: user.lastLoginCountry,
          lastLoginAt: user.lastLoginAt,
          newLoginIp: context.ipAddress,
          newLoginCountry,
          velocityKmh: result.velocityKmh,
          distanceKm: result.distanceKm,
        },
        '🚨 Impossible travel threat detected'
      );

      if (redisClient) {
        // Suspend session refresh capability for 24 hours
        await redisClient.set(`impossible_travel:${user.id}`, 'true', 'EX', 86400);
      } else {
        // Fallback to in-memory set in test/dev environments without Redis
        mockImpossibleTravelSuspensions.add(user.id);
      }
    }
  }

  return newLoginCountry;
}

export async function login(
  dto: LoginInput,
  context: SessionContext
): Promise<{ user: UserProfile; tokens: TokenPair }> {
  const user = await prisma.user.findFirst({
    where: { email: dto.email, deletedAt: null },
  });
  if (!user) {
    logger.warn({
      type: 'security',
      event: 'FAILED_LOGIN',
      email: dto.email,
      reason: 'Invalid credentials',
    });
    throw new UnauthorizedError('Invalid email or password');
  }

  if (!user.isActive) {
    logger.warn({
      type: 'security',
      event: 'FAILED_LOGIN',
      email: dto.email,
      reason: 'Account is disabled',
    });
    throw new UnauthorizedError('Account is disabled');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    logger.warn({
      type: 'security',
      event: 'FAILED_LOGIN',
      email: dto.email,
      reason: 'Account is locked',
    });
    throw new UnauthorizedError('Account is temporarily locked. Please try again later.');
  }

  const valid = await bcrypt.compare(dto.password, user.passwordHash);
  if (!valid) {
    const attempts = (user.failedLoginAttempts || 0) + 1;
    const updates: { failedLoginAttempts: number; lockedUntil?: Date | null } = {
      failedLoginAttempts: attempts,
    };

    if (attempts >= config.security.maxFailedLogins) {
      updates.lockedUntil = new Date(
        Date.now() + config.security.lockoutDurationMinutes * 60 * 1000
      );
      logger.warn({
        type: 'security',
        event: 'ACCOUNT_LOCKED',
        email: dto.email,
        reason: `Exceeded ${config.security.maxFailedLogins} failed attempts`,
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updates,
    });

    logger.warn({
      type: 'security',
      event: 'FAILED_LOGIN',
      email: dto.email,
      reason: 'Invalid credentials',
    });
    throw new UnauthorizedError('Invalid email or password');
  }

  const newLoginCountry = await assessLoginLocation(user, context);

  return prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: context.ipAddress,
        lastLoginCountry: newLoginCountry,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    logger.info({ type: 'security', event: 'SUCCESSFUL_LOGIN', email: dto.email });

    const tokens = await issueTokenPair(updatedUser, context, tx);
    const profile = await _buildProfile(updatedUser.id, tx);

    return { user: profile, tokens };
  });
}

export async function refresh(
  rawRefreshToken: string,
  context: SessionContext
): Promise<TokenPair> {
  let payload: ReturnType<typeof verifyRefreshToken>;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const tokenHash = hashToken(rawRefreshToken);

  if (redisClient) {
    const suspended = await redisClient.get(`impossible_travel:${payload.sub}`);
    if (suspended) {
      logger.warn(
        {
          type: 'security',
          event: 'REFRESH_BLOCKED_IMPOSSIBLE_TRAVEL',
          userId: payload.sub,
        },
        'Refresh token request blocked due to active impossible travel suspension'
      );
      throw new UnauthorizedError(
        'Session suspended: unusual login location detected. Please verify your identity.'
      );
    }
  } else if (mockImpossibleTravelSuspensions.has(payload.sub)) {
    logger.warn(
      {
        type: 'security',
        event: 'REFRESH_BLOCKED_IMPOSSIBLE_TRAVEL',
        userId: payload.sub,
      },
      'Refresh token request blocked due to active impossible travel suspension (in-memory)'
    );
    throw new UnauthorizedError(
      'Session suspended: unusual login location detected. Please verify your identity.'
    );
  }

  return prisma.$transaction(async (tx) => {
    // 1. Fetch token and check status
    const storedToken = (await tx.refreshToken.findFirst({
      where: {
        userId: payload.sub,
        tokenHash,
      },
    })) as unknown as {
      id: string;
      userId: string;
      tokenHash: string;
      jti: string | null;
      used: boolean;
      ipAddress: string | null;
      userAgent: string | null;
      deviceFingerprint: string | null;
      expiresAt: Date;
      createdAt: Date;
    };

    if (!storedToken) {
      throw new UnauthorizedError('Refresh token has been revoked');
    }

    // 2. Token theft reuse / replay attack check
    if (storedToken.used) {
      logger.error(
        {
          type: 'security',
          event: 'TOKEN_THEFT_DETECTED',
          userId: payload.sub,
          jti: storedToken.jti,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        `Token replay detected for JTI ${storedToken.jti}. Revoking all sessions.`
      );

      // Immediate revocation of all refresh tokens for this user
      await tx.refreshToken.deleteMany({
        where: { userId: payload.sub },
      });

      // Clear all active sessions from Redis
      if (redisClient) {
        try {
          const keys = await redisClient.keys(`sess:${payload.sub}:*`);
          if (keys.length > 0) {
            await redisClient.del(...keys);
          }
        } catch (err) {
          logger.error(
            { type: 'infrastructure', err },
            'Failed to clear Redis sessions on token theft'
          );
        }
      }

      throw new UnauthorizedError('Session hijacked. Please login again.');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token has expired');
    }

    // 3. Device fingerprint anomaly check
    if (
      storedToken.deviceFingerprint &&
      storedToken.deviceFingerprint !== context.deviceFingerprint
    ) {
      logger.warn(
        {
          type: 'security',
          event: 'DEVICE_CHANGE_DETECTED',
          userId: payload.sub,
          jti: storedToken.jti,
          expectedFingerprint: storedToken.deviceFingerprint,
          receivedFingerprint: context.deviceFingerprint,
        },
        'Device change detected during token refresh'
      );

      throw new UnauthorizedError('Device mismatch. Please log in again.');
    }

    const user = await tx.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
    });
    if (!user || !user.isActive) throw new UnauthorizedError('Account not found or disabled');

    // 4. Mark old token as used and issue new pair
    await tx.refreshToken.update({
      where: { id: storedToken.id },
      data: { used: true },
    });

    if (redisClient && storedToken.jti) {
      await redisClient.del(`sess:${payload.sub}:${storedToken.jti}`);
    }

    return issueTokenPair(user, context, tx);
  });
}

export async function logout(rawRefreshToken?: string, rawAccessToken?: string): Promise<void> {
  if (rawRefreshToken) {
    try {
      const payload = verifyRefreshToken(rawRefreshToken);
      const tokenHash = hashToken(rawRefreshToken);

      const storedToken = (await prisma.refreshToken.findFirst({
        where: { userId: payload.sub, tokenHash },
      })) as unknown as {
        id: string;
        userId: string;
        tokenHash: string;
        jti: string | null;
        used: boolean;
        ipAddress: string | null;
        userAgent: string | null;
        deviceFingerprint: string | null;
        expiresAt: Date;
        createdAt: Date;
      };

      if (storedToken) {
        await prisma.refreshToken.delete({
          where: { id: storedToken.id },
        });

        if (redisClient && storedToken.jti) {
          await redisClient.del(`sess:${payload.sub}:${storedToken.jti}`);
        }
      }
    } catch {
      // already invalid — ignore
    }
  }

  if (rawAccessToken && redisClient) {
    try {
      const payload = verifyAccessToken(rawAccessToken);
      if (payload.jti && payload.exp) {
        const ttl = payload.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await redisClient.set(`bl:${payload.jti}`, 'revoked', 'EX', ttl);
        }
      }
    } catch {
      // already invalid — ignore
    }
  }
}

// ── Active Sessions Dashboard ──────────────────────────────────────
export interface ActiveSessionInfo {
  jti: string;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
  expiresAt: Date;
}

export async function listSessions(userId: string): Promise<ActiveSessionInfo[]> {
  const sessions = (await prisma.refreshToken.findMany({
    where: {
      userId,
      used: false,
      expiresAt: { gt: new Date() },
    } as unknown as Prisma.RefreshTokenWhereInput,
    select: {
      jti: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    } as unknown as Prisma.RefreshTokenSelect,
  })) as unknown as Array<{
    jti: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
    expiresAt: Date;
  }>;

  return sessions.map((s) => ({
    jti: s.jti || 'unknown',
    ipAddress: s.ipAddress || 'unknown',
    userAgent: s.userAgent || 'unknown',
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
  }));
}

export async function revokeSession(userId: string, jti: string): Promise<void> {
  const stored = (await prisma.refreshToken.findFirst({
    where: { userId, jti } as unknown as Prisma.RefreshTokenWhereInput,
  })) as unknown as { id: string } | null;

  if (stored) {
    await prisma.refreshToken.delete({
      where: { id: stored.id },
    });

    if (redisClient) {
      await redisClient.del(`sess:${userId}:${jti}`);
    }
  }
}

export async function revokeOtherSessions(userId: string, currentJti: string): Promise<void> {
  const sessions = (await prisma.refreshToken.findMany({
    where: {
      userId,
      NOT: { jti: currentJti },
    } as unknown as Prisma.RefreshTokenWhereInput,
  })) as unknown as Array<{ id: string; jti: string | null }>;

  if (sessions.length > 0) {
    const ids = sessions.map((s) => s.id);
    await prisma.refreshToken.deleteMany({
      where: { id: { in: ids } },
    });

    if (redisClient) {
      for (const s of sessions) {
        if (s.jti) {
          await redisClient.del(`sess:${userId}:${s.jti}`);
        }
      }
    }
  }
}

export async function getMe(userId: string): Promise<UserProfile> {
  return _buildProfile(userId);
}

// ── Private helpers ───────────────────────────────────────────────
async function _buildProfile(userId: string, tx?: Prisma.TransactionClient): Promise<UserProfile> {
  const db = tx || prisma;
  const user = await db.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: {
      roles: {
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) throw new NotFoundError('User');

  const mappedRoles = user.roles.map((ur) => ({
    id: ur.role.id,
    name: ur.role.name,
    permissions: ur.role.permissions.map((rp) => ({
      name: rp.permission.name,
    })),
  }));

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    roles: mappedRoles,
  };
}
