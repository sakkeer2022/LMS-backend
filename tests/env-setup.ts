/**
 * TEST ENVIRONMENT SOURCE OF TRUTH
 *
 * This file MUST remain the first entry in vitest.config.ts `setupFiles`.
 * It runs before any other module is imported, including `tests/setup.ts`
 * and `src/config/index.ts`.
 *
 * WHY ORDER MATTERS:
 * `src/config/index.ts` calls `validateEnv()` at module-import time, which
 * will throw if `JWT_SECRET` or `JWT_REFRESH_SECRET` are missing. Because
 * `tests/setup.ts` imports `@config/index`, this file must pre-populate all
 * required environment variables before that import is resolved.
 *
 * HOW TO ADD A NEW REQUIRED ENV VAR:
 * If `validateEnv()` in `src/config/index.ts` gains a new required variable,
 * add a fake deterministic value for it here. Do NOT add test conditionals to
 * production config files.
 *
 * WHAT IS NOT NEEDED HERE:
 * Variables with safe `?? 'default'` fallbacks in `src/config/index.ts` do
 * not need to be listed here (e.g. DB_HOST, PORT, REDIS_URL).
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * TEST_DATABASE_URL from the shell, else from `.env`. Only this one key is read here:
 * `src/config/index.ts` loads the rest of `.env` later, and it must not replace the test
 * DATABASE_URL set below with the development database.
 */
function testDatabaseUrl(): string | undefined {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const envFile = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envFile)) return undefined;
  return dotenv.parse(fs.readFileSync(envFile)).TEST_DATABASE_URL || undefined;
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  testDatabaseUrl() || 'postgresql://postgres:password@localhost:5432/amentorz_test?schema=public';
process.env.JWT_SECRET ??= 'test-jwt-secret-deterministic';
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-secret-deterministic';
process.env.COOKIE_SECRET ??= 'test-cookie-secret-deterministic';

// Tests never send real email or write real files. Set unconditionally: src/config loads
// .env without overriding variables that are already set, so a developer .env with
// EMAIL_TRANSPORT=smtp or STORAGE_DRIVER=local would otherwise reach the test run.
process.env.EMAIL_TRANSPORT = 'memory';
process.env.STORAGE_DRIVER = 'memory';

// Faculty invitations (LMS-79): a small per-admin budget so the 429 path is testable.
// Each integration test logs in a new admin, so every test starts with a full budget.
process.env.FACULTY_INVITE_RATE_LIMIT_MAX ??= '5';
// Route limits high enough that suites sharing one app and one IP never hit them;
// tests that exercise the limits set their own values before importing the app.
process.env.LOGIN_RATE_LIMIT_MAX_PER_IP ??= '100000';
process.env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL ??= '100000';
process.env.REFRESH_RATE_LIMIT_MAX_PER_IP ??= '100000';
process.env.OTP_SEND_RATE_LIMIT_MAX_PER_IP ??= '100000';
process.env.OTP_SEND_RATE_LIMIT_MAX_PER_EMAIL ??= '100000';
process.env.OTP_VERIFY_RATE_LIMIT_MAX_PER_IP ??= '100000';

// Faculty onboarding (LMS-39): every suite calls the public routes from 127.0.0.1, so the
// per-IP budget is raised; the limiter itself is covered by tests/unit/rate-limit.test.ts.
process.env.FACULTY_ONBOARDING_RATE_LIMIT_MAX ??= '500';
