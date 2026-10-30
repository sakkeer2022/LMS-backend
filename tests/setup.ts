import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma, connectDatabase, disconnectDatabase, assertTestDatabaseUrl } from '@infrastructure/database/index';
import { config } from '@config/index';

const MIGRATIONS_DIR = path.resolve(__dirname, '../prisma/migrations');

let tablesToTruncate: string[] = [];

/**
 * Fails fast when the test database is missing migrations, so tests never run
 * against a stale or partially migrated schema.
 */
async function assertMigrationsApplied(): Promise<void> {
  const expected = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let applied: string[];
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    applied = rows.map((row) => row.migration_name);
  } catch {
    applied = [];
  }

  const missing = expected.filter((name) => !applied.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `[TEST SETUP] Test database is missing ${missing.length} migration(s): ${missing.join(', ')}. ` +
        'Run `DATABASE_URL=<TEST_DATABASE_URL> npx prisma migrate deploy` first.'
    );
  }
}

beforeAll(async () => {
  // Ensure we are in test environment to avoid wiping prod/dev databases!
  if (config.env !== 'test') {
    throw new Error('Tests must be run with NODE_ENV=test');
  }

  // Strict safety check: Validate that DATABASE_URL targets an approved isolated test database
  // Throws a sanitized Error without leaking credentials if invalid.
  assertTestDatabaseUrl(config.databaseUrl);

  // Connect to the DB
  await connectDatabase();
  await assertMigrationsApplied();

  // Truncate every migrated table so newly added models are never missed
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  tablesToTruncate = rows.map((row) => row.tablename);

  // Also clean before the test file's own beforeAll hooks run, so data left by
  // the previous file (for example seeded permissions) never leaks into this one.
  await truncateAllTables();
});

const DEADLOCK_SQLSTATE = '40P01';
const MAX_TRUNCATE_ATTEMPTS = 5;

beforeEach(async () => {
  await truncateAllTables();
});

async function truncateAllTables(): Promise<void> {
  // Clean test state without dropping DB structure; errors must fail the test run
  if (tablesToTruncate.length === 0) return;
  const tableList = tablesToTruncate.map((table) => `"${table}"`).join(', ');

  // The audit middleware writes after the response is sent, so the previous
  // test's insert can still be in flight and deadlock with TRUNCATE. Retry those.
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} CASCADE;`);
      return;
    } catch (err) {
      const isDeadlock = err instanceof Error && err.message.includes(DEADLOCK_SQLSTATE);
      if (!isDeadlock || attempt >= MAX_TRUNCATE_ATTEMPTS) throw err;
      console.warn(`[TEST SETUP] TRUNCATE deadlock, retry ${attempt} at ${new Date().toISOString()}`);
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

afterAll(async () => {
  await disconnectDatabase();
});
