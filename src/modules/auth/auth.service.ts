import { prisma } from '@infrastructure/database/index';
import { verifyAccessToken, verifyRefreshToken } from '@core/security/jwt';
import { redisClient } from '@infrastructure/redis/connection';
import { logger } from '@core/logger/index';
import { markSessionRevoked } from '@core/security/session-revocation';
import { hashToken } from './session.js';
import { resolveCountry, detectImpossibleTravel } from '@core/security/travel';

export const mockImpossibleTravelSuspensions = new Set<string>();

// ── Service ──────────────────────────────────────────────────────
export interface SessionContext {
  ipAddress: string;
  userAgent: string;
  deviceFingerprint: string;
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
