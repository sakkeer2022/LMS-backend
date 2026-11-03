import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

import { TooManyRequestsError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { redisClient } from '../infrastructure/redis/connection';

export interface RouteLimit {
  windowMs: number;
  max: number;
}

export interface RouteRateLimitOptions {
  /** Unique name, used as the Redis key prefix and in logs (for example `login`). */
  name: string;
  /** Limit per client IP. */
  ip: RouteLimit;
  /** Optional limit per normalised `body.email`, applied after the IP limit. */
  email?: RouteLimit;
}

const clientIp = (req: Request): string => ipKeyGenerator(req.ip ?? 'unknown');

/** The normalised email in the request body, or the client IP when there is none. */
const emailOrIp = (req: Request): string => {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email === 'string' && email.trim() !== '')
    return `email:${email.trim().toLowerCase()}`;
  return `ip:${clientIp(req)}`;
};

function limiter(
  name: string,
  scope: 'ip' | 'email',
  limit: RouteLimit,
  keyGenerator: (req: Request) => string
): RequestHandler {
  return rateLimit({
    // Redis in every environment but test, where the memory store keeps tests stateless
    store: redisClient
      ? new RedisStore({
          prefix: `rl:${name}:${scope}:`,
          // @ts-expect-error - rate-limit-redis types differ slightly from ioredis
          sendCommand: (...args: string[]): unknown => redisClient?.call(...args),
        })
      : undefined,
    windowMs: limit.windowMs,
    limit: limit.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, _res, next) => {
      logger.warn({ type: 'security', route: name, scope, ip: req.ip }, 'Route rate limit hit');
      next(new TooManyRequestsError('Too many requests, please try again later.'));
    },
  });
}

/**
 * Per-route rate limits on top of the global limiter in `src/app.ts`. Returns the handlers to
 * place before the controller; mount after the body parser so the email limit can read the body.
 * A rejected request gets 429 with `Retry-After` and the standard `RateLimit` headers.
 */
export function routeRateLimit(options: RouteRateLimitOptions): RequestHandler[] {
  const handlers = [limiter(options.name, 'ip', options.ip, clientIp)];
  if (options.email) handlers.push(limiter(options.name, 'email', options.email, emailOrIp));
  return handlers;
}
