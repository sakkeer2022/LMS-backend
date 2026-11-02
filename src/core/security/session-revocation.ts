import { redisClient } from '@infrastructure/redis/connection';
import { getAccessTokenTtlSeconds } from './jwt.js';

// Used when Redis is not connected (tests, local runs without Redis)
const memoryRevoked = new Set<string>();

/**
 * Marks a session family revoked so its access tokens stop working at once (they would
 * otherwise live until they expire). The mark only needs to outlive one access token.
 */
export async function markSessionRevoked(sid: string): Promise<void> {
  if (redisClient) {
    await redisClient.set(`rf:${sid}`, 'revoked', 'EX', getAccessTokenTtlSeconds() + 60);
  } else {
    memoryRevoked.add(sid);
  }
}

export async function isSessionRevoked(sid: string): Promise<boolean> {
  if (redisClient) return (await redisClient.get(`rf:${sid}`)) !== null;
  return memoryRevoked.has(sid);
}
