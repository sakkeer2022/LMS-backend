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

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:password@localhost:5432/amentorz_test?schema=public';
process.env.JWT_SECRET ??= 'test-jwt-secret-deterministic';
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-secret-deterministic';
process.env.COOKIE_SECRET ??= 'test-cookie-secret-deterministic';
