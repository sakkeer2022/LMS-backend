import type { Request, RequestHandler } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from '@infrastructure/redis/connection';
import { TooManyRequestsError } from '@core/errors/index';

export interface RouteRateLimitOptions {
  /** Unique name; separates this limiter's counters from every other limiter. */
  name: string;
  windowMs: number;
  max: number;
  /**
   * user: one budget per authenticated user (falls back to the IP when there is none);
   * ip: one budget per client IP.
   */
  keyBy: 'user' | 'ip';
  message?: string;
}

/** Counter key for a request; exported for tests. */
export function rateLimitKey(req: Request, keyBy: RouteRateLimitOptions['keyBy']): string {
  const userId = req.user?.sub;
  if (keyBy === 'user' && userId) return `user:${userId}`;
  return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

/**
 * Per-route rate limiter (planned in SHARED_COMPONENTS.md). Redis-backed in running
 * environments so every instance shares the budget; in-memory in tests, where Redis
 * is not connected. Mount it after `authenticate` when keying by user. Responds 429
 * with a Retry-After header through the standard error envelope.
 */
export function createRouteRateLimiter(options: RouteRateLimitOptions): RequestHandler {
  const prefix = `rl:${options.name}:`;
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisClient
      ? new RedisStore({
          prefix,
          // @ts-expect-error - rate-limit-redis types differ slightly from ioredis
          sendCommand: (...args: string[]): unknown => redisClient?.call(...args),
        })
      : undefined,
    keyGenerator: (req) => `${prefix}${rateLimitKey(req, options.keyBy)}`,
    handler: (_req, _res, next) => {
      next(
        new TooManyRequestsError(options.message ?? 'Too many requests, please try again later.')
      );
    },
  });
}
