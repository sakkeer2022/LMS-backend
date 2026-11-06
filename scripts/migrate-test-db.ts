/**
 * Applies the Prisma migrations to the test database (npm run test:db:migrate).
 *
 * Reads TEST_DATABASE_URL from the shell or `.env` (the same rule as tests/env-setup.ts),
 * refuses anything but an approved local `amentorz_test` database, then runs
 * `prisma migrate deploy` with DATABASE_URL pointed at it. Works in PowerShell and cmd,
 * where `DATABASE_URL=... npx prisma migrate deploy` does not.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { assertTestDatabaseUrl } from '../src/infrastructure/database/safety-guard';

const DEFAULT_TEST_DATABASE_URL =
  'postgresql://postgres:password@localhost:5432/amentorz_test?schema=public';

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const envFile = path.resolve(__dirname, '../.env');
  const fromFile = fs.existsSync(envFile)
    ? dotenv.parse(fs.readFileSync(envFile)).TEST_DATABASE_URL
    : undefined;
  return fromFile || DEFAULT_TEST_DATABASE_URL;
}

const url = testDatabaseUrl();
assertTestDatabaseUrl(url);
const target = new URL(url);
console.log(`Migrating ${target.hostname}:${target.port || '5432'}${target.pathname}`);

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(result.status ?? 1);
