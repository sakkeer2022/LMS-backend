import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { config } from '@config/index';
import { logger } from '@core/logger/index';
import { dbQueryDurationSeconds, activeDatabaseConnections } from '@core/metrics/index';

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
  // Prisma's 5s default expires on hosted free tiers with slow database round trips (QA on Render).
  transactionOptions: { maxWait: 10_000, timeout: 30_000 },
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'info' },
    { emit: 'stdout', level: 'warn' },
    { emit: 'stdout', level: 'error' },
  ],
});

// Configure Prisma query logging to hook into our Pino logger + metrics
prisma.$on('query', (e: { query: string; params: string; duration: number }) => {
  // Record query duration as seconds into the Prometheus histogram
  dbQueryDurationSeconds.observe(e.duration / 1000);

  // Redact bound parameters entirely to prevent credential and PII leakage
  logger.debug({
    type: 'database_query',
    sql: e.query,
    durationMs: e.duration,
  });
});

/** Returns current pg.Pool connection counts. */
export function getPoolStats(): { total: number; idle: number; waiting: number } {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

let poolMetricsInterval: NodeJS.Timeout | null = null;

export async function connectDatabase(): Promise<void> {
  // Pools connect lazily, but we can check connection health
  const client = await pool.connect();
  client.release();
  logger.info('✅ Database connected via Prisma & PG Pool');

  // Update the active connections gauge every 5 seconds
  poolMetricsInterval = setInterval(() => {
    activeDatabaseConnections.set(pool.totalCount);
  }, 5_000);

  // Prevent the interval from keeping the process alive in test/CI environments
  if (poolMetricsInterval.unref) {
    poolMetricsInterval.unref();
  }
}

/**
 * Waits until no pool client is checked out, or `timeoutMs` passes. Work started after a response
 * was sent (the audit middleware) can still be running; disconnecting Prisma in the middle of its
 * transaction leaves that client checked out for good, and `pool.end()` then never resolves.
 */
export async function waitForIdlePool(timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (pool.totalCount - pool.idleCount > 0 || pool.waitingCount > 0) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

export async function disconnectDatabase(): Promise<void> {
  if (poolMetricsInterval) {
    clearInterval(poolMetricsInterval);
    poolMetricsInterval = null;
  }

  if (!(await waitForIdlePool())) {
    logger.warn(getPoolStats(), 'Closing the database pool with queries still running');
  }
  await prisma.$disconnect();
  await pool.end();
  logger.info('Database connection closed');
}
