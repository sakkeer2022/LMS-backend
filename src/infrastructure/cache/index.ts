import { redisClient } from '@infrastructure/redis/connection';
import { logger } from '@core/logger/index';

/**
 * Small JSON cache (ADR-0005: the admin category tree). Redis in running environments,
 * so every instance sees the same invalidation; an in-memory double in tests, where
 * Redis is not connected. Cache failures never fail a request: reads fall through to
 * the database and a failed delete is logged.
 */
export interface JsonCache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

type RedisLike = NonNullable<typeof redisClient>;

export class RedisJsonCache implements JsonCache {
  constructor(private readonly client: RedisLike) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (err) {
      logger.warn({ err, key }, 'Cache read failed; using the database');
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      logger.warn({ err, key }, 'Cache write failed');
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      // A stale entry expires with its TTL; log so it can be investigated
      logger.error({ err, key }, 'Cache invalidation failed');
    }
  }
}

export class InMemoryJsonCache implements JsonCache {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.entries.set(key, {
      value: JSON.stringify(value),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

export const appCache: JsonCache = redisClient
  ? new RedisJsonCache(redisClient)
  : new InMemoryJsonCache();
