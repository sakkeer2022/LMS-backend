import { Redis } from 'ioredis';
import { config } from '@config/index';
import { logger } from '@core/logger/index';

// We do not connect to Redis during testing to keep the test environment stateless and fast.
const isTest = config.env === 'test';

export const redisClient = isTest
  ? null
  : new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number): number | null {
        // Retry up to 3 times, with an increasing delay
        const delay = Math.min(times * 500, 2000);
        return times > 3 ? null : delay;
      },
    });

if (redisClient) {
  redisClient.on('connect', () => {
    logger.info({ type: 'infrastructure' }, 'Redis client connected');
  });

  redisClient.on('error', (err) => {
    logger.error({ type: 'infrastructure', err }, 'Redis client error');
  });

  redisClient.on('ready', () => {
    logger.info({ type: 'infrastructure' }, 'Redis client ready');
  });
}
