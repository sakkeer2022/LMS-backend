import { backgroundJobQueue } from '@infrastructure/queue/index.js';
import { logger } from '@core/logger/index';
import type { FileQuarantine } from '@middleware/upload.js';

export async function enqueueQuarantinedUpload(
  file: FileQuarantine,
  userId: string
): Promise<{ key: string; status: 'quarantined' }> {
  await backgroundJobQueue.add('scan-file', {
    quarantineKey: file.key,
    storagePath: file.storagePath,
    originalName: file.originalName,
    mimetype: file.mimetype,
    size: file.size,
    userId,
  });
  logger.info({ type: 'upload', userId, key: file.key }, 'Quarantined upload queued for scanning');
  // Accepted for processing, not a claim that scanning completed or content is safe.
  return { key: file.key, status: 'quarantined' as const };
}
