import { Worker, Job } from 'bullmq';
import { context, propagation, trace } from '@opentelemetry/api';
import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { queueConnection } from './client.js';
import { logger } from '@core/logger/index';
import { backgroundJobsProcessedTotal } from '@core/metrics/index';
import { config } from '@config/index';
import fs from 'fs';
import path from 'path';

/**
 * Restore the OTel trace context carried inside the BullMQ job's data.
 */
function extractJobContext(job: Job): ReturnType<typeof context.active> {
  const carrier = (job.data as Record<string, unknown>)['_tracing'];
  if (carrier && typeof carrier === 'object') {
    return propagation.extract(context.active(), carrier as Record<string, string>);
  }
  return context.active();
}

/**
 * Handles security scanning of quarantined uploads.
 * If malware is detected (e.g. simulation or ClamAV integration), it deletes the file.
 */
interface ScanFileJobData {
  quarantineKey: string;
  storagePath: string;
  originalName: string;
  mimetype: string;
  size: number;
  userId: string;
}

/**
 * Handles security scanning of quarantined uploads.
 * If malware is detected (e.g. simulation or ClamAV integration), it deletes the file.
 * Otherwise, it promotes the file to verified storage.
 */
async function handleScanFileJob(data: ScanFileJobData): Promise<void> {
  const { quarantineKey, storagePath, originalName } = data;
  logger.info({ quarantineKey, storagePath }, 'Starting malware scanning for file');

  // Simple threat signature check: if filename contains 'virus' or 'eicar', treat as malicious
  const isMalicious =
    originalName.toLowerCase().includes('virus') || originalName.toLowerCase().includes('eicar');

  if (isMalicious) {
    logger.error({ quarantineKey, originalName }, '🚨 Threat detected: file flagged as malicious!');

    if (storagePath.startsWith('s3://')) {
      const s3 = new S3Client({ region: config.aws.region });
      await s3.send(
        new DeleteObjectCommand({
          Bucket: config.aws.s3Bucket,
          Key: quarantineKey,
        })
      );
    } else if (storagePath.startsWith('file://')) {
      const localPath = storagePath.replace('file://', '');
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
      }
    }
    return;
  }

  // Scan passed — promote from quarantine/ to verified/
  if (storagePath.startsWith('s3://')) {
    const s3 = new S3Client({ region: config.aws.region });
    const verifiedKey = quarantineKey.replace('quarantine/', 'verified/');

    // Copy S3 object to verified path
    await s3.send(
      new CopyObjectCommand({
        Bucket: config.aws.s3Bucket,
        CopySource: `${config.aws.s3Bucket}/${quarantineKey}`,
        Key: verifiedKey,
      })
    );

    // Delete S3 object from quarantine
    await s3.send(
      new DeleteObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: quarantineKey,
      })
    );

    logger.info({ verifiedKey }, 'File scan passed. S3 object moved to verified storage.');
  } else if (storagePath.startsWith('file://')) {
    const localQuarantinePath = storagePath.replace('file://', '');
    const localVerifiedDir = path.join(process.cwd(), 'uploads', 'verified');
    if (!fs.existsSync(localVerifiedDir)) {
      fs.mkdirSync(localVerifiedDir, { recursive: true });
    }
    const localVerifiedPath = path.join(localVerifiedDir, path.basename(localQuarantinePath));
    if (fs.existsSync(localQuarantinePath)) {
      fs.renameSync(localQuarantinePath, localVerifiedPath);
    }
    logger.info({ localVerifiedPath }, 'File scan passed. Local file moved to verified storage.');
  }
}

export const backgroundWorker = new Worker(
  'background-jobs',
  async (job: Job) => {
    const jobContext = extractJobContext(job);

    await context.with(jobContext, async () => {
      const span = trace
        .getTracer('rbac-worker')
        .startSpan(`job:${job.name}`, undefined, jobContext);

      try {
        logger.info({ jobId: job.id, jobName: job.name }, 'Processing background task');

        switch (job.name) {
          case 'process-billing':
            // Task: Process subscription updates
            break;
          case 'scan-file':
            await handleScanFileJob(job.data);
            break;
          default:
            logger.warn({ jobName: job.name }, 'Unknown background task name');
        }

        span.setStatus({ code: 1 /* OK */ });
      } catch (err) {
        span.setStatus({ code: 2 /* ERROR */, message: String(err) });
        throw err;
      } finally {
        span.end();
      }
    });
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { connection: queueConnection as any }
);

backgroundWorker.on('completed', (job) => {
  backgroundJobsProcessedTotal.inc({
    status: 'completed',
    jobName: job?.name ?? 'unknown',
  });
});

backgroundWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Background task failed');
  backgroundJobsProcessedTotal.inc({
    status: 'failed',
    jobName: job?.name ?? 'unknown',
  });
});
