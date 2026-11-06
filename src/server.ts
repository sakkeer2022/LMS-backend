// ⚠️ OTel SDK must be initialised before any other imports.
// Auto-instrumentation hooks are installed at module-load time.
import './tracing.js';

import { createApp } from './app.js';
import { config } from '@config/index';
import { logger } from '@core/logger/index';
import { connectDatabase, disconnectDatabase } from '@infrastructure/database/index';
import { scheduleConsentPurge } from '@infrastructure/queue/index';
import { redisClient } from '@infrastructure/redis/connection';

async function bootstrap(): Promise<void> {
  const app = createApp();

  await connectDatabase();

  if (redisClient) {
    try {
      await redisClient.ping();
      logger.info('🚀 Redis connection established');
    } catch (err) {
      logger.error({ err }, 'Failed to connect to Redis during bootstrap');
      process.exit(1);
    }
  }

  // Unused signed consents expire; this removes them (and their PDFs) every hour
  try {
    await scheduleConsentPurge();
  } catch (err) {
    logger.error({ err }, 'Could not schedule the consent purge job');
  }

  const server = app.listen(config.port, () => {
    logger.info(`🚀 Server running on port ${config.port} [${config.env}]`);
    logger.info(`📖 API prefix: ${config.apiPrefix}`);
    logger.info(`❤️  Health: http://localhost:${config.port}/health`);
  });

  // ── Graceful shutdown ─────────────────────────────────────────
  function shutdown(signal: string): void {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await disconnectDatabase();
      if (redisClient) {
        await redisClient.quit();
      }
      logger.info('HTTP server closed');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — shutting down');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection — shutting down');
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
