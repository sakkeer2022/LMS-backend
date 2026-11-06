import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '@config/index';

// Create a dedicated Redis connection for BullMQ (maxRetriesPerRequest must be null)
export const queueConnection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null,
});

export const backgroundJobQueue = new Queue('background-jobs', {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: queueConnection as any,
});

/** Runs the purge of expired, unused guardian consents every hour (adding it again is harmless). */
export async function scheduleConsentPurge(): Promise<void> {
  await backgroundJobQueue.add(
    'purge-expired-consents',
    {},
    {
      repeat: { every: 60 * 60 * 1000 },
      jobId: 'purge-expired-consents',
      removeOnComplete: true,
      removeOnFail: 20,
    }
  );
}
