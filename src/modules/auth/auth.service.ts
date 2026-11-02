import bcrypt from 'bcrypt';
import { prisma } from '@infrastructure/database/index';
import type { Prisma } from '@prisma/client';
import { verifyAccessToken, verifyRefreshToken, type TokenPair } from '@core/security/jwt';
import { redisClient } from '@infrastructure/redis/connection';
import { ConflictError, NotFoundError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import type { RegisterInput } from './auth.dto.js';
import { markSessionRevoked } from '@core/security/session-revocation';
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
        if (payload.sid) await markSessionRevoked(payload.sid);

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
