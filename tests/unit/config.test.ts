import { describe, it, expect } from 'vitest';
import {
  envSchema,
  resolveAllowedOrigins,
  DEFAULT_DEV_ALLOWED_ORIGINS,
} from '../../src/config/index.js';

describe('Configuration Schema & Razorpay Validation Unit Tests', () => {
  const baseValidDevEnv = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://postgres:password@localhost:5432/amentorz_dev?schema=public',
    JWT_SECRET: 'min-32-chars-jwt-secret-for-testing-1234',
    JWT_REFRESH_SECRET: 'min-32-chars-jwt-refresh-secret-5678',
    COOKIE_SECRET: 'min-32-chars-cookie-secret-deterministic-9999',
  };

  const baseValidProdEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://prod_user:secret@localhost:5432/amentorz_prod?schema=public',
    JWT_SECRET: 'production-jwt-secret-at-least-32-characters-long',
    JWT_REFRESH_SECRET: 'production-jwt-refresh-secret-at-least-32-chars',
    COOKIE_SECRET: 'production-cookie-secret-at-least-32-chars-long',
    ALLOWED_ORIGINS: 'https://app.amentorz.com,https://admin.amentorz.com',
    APP_BASE_URL: 'https://app.amentorz.com',
    RAZORPAY_KEY_ID: 'rzp_live_1234567890abcdef',
    RAZORPAY_KEY_SECRET: 'live_secret_key_minimum_16_chars',
    RAZORPAY_WEBHOOK_SECRET: 'live_webhook_secret_min_16_chars',
    METRICS_TOKEN: 'production-metrics-token-at-least-32-chars',
    SMTP_HOST: 'smtp.example.org',
  };

  it('Development: allows default Razorpay placeholders without errors', () => {
    const result = envSchema.safeParse(baseValidDevEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.RAZORPAY_KEY_ID).toBe('rzp_test_placeholder');
      expect(result.data.RAZORPAY_KEY_SECRET).toBe('rzp_secret_placeholder');
      expect(result.data.RAZORPAY_WEBHOOK_SECRET).toBe('whsec_placeholder');
    }
  });

  it('route rate limits have defaults and can be overridden', () => {
    const defaults = envSchema.safeParse(baseValidDevEnv);
    expect(defaults.success).toBe(true);
    if (defaults.success) {
      expect(defaults.data.LOGIN_RATE_LIMIT_MAX_PER_IP).toBe(20);
      expect(defaults.data.LOGIN_RATE_LIMIT_MAX_PER_EMAIL).toBe(10);
      expect(defaults.data.REFRESH_RATE_LIMIT_MAX_PER_IP).toBe(60);
    }

    const custom = envSchema.safeParse({ ...baseValidDevEnv, LOGIN_RATE_LIMIT_MAX_PER_IP: '5' });
    expect(custom.success && custom.data.LOGIN_RATE_LIMIT_MAX_PER_IP).toBe(5);

    expect(
      envSchema.safeParse({ ...baseValidDevEnv, REFRESH_RATE_LIMIT_WINDOW_MS: '0' }).success
    ).toBe(false);
  });

  it('Development: accepts custom rzp_test_ keys', () => {
    const result = envSchema.safeParse({
      ...baseValidDevEnv,
      RAZORPAY_KEY_ID: 'rzp_test_sandbox123',
      RAZORPAY_KEY_SECRET: 'test_secret_456',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.RAZORPAY_KEY_ID).toBe('rzp_test_sandbox123');
    }
  });

  it('Production: authorizes valid live credentials', () => {
    const result = envSchema.safeParse(baseValidProdEnv);
    expect(result.success).toBe(true);
  });

  it('Production: rejects when RAZORPAY_KEY_ID uses test placeholder', () => {
    const result = envSchema.safeParse({
      ...baseValidProdEnv,
      RAZORPAY_KEY_ID: 'rzp_test_placeholder',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message);
      expect(issues).toContain(
        'RAZORPAY_KEY_ID must be configured with a live key (rzp_live_...) in production'
      );
    }
  });

  it('Production: rejects when RAZORPAY_KEY_ID starts with rzp_test_', () => {
    const result = envSchema.safeParse({
      ...baseValidProdEnv,
      RAZORPAY_KEY_ID: 'rzp_test_liveprefixfail',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message);
      expect(issues).toContain(
        'RAZORPAY_KEY_ID must be configured with a live key (rzp_live_...) in production'
      );
    }
  });

  it('Production: rejects when RAZORPAY_KEY_SECRET is placeholder or < 16 chars', () => {
    const result = envSchema.safeParse({
      ...baseValidProdEnv,
      RAZORPAY_KEY_SECRET: 'short_secret',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message);
      expect(issues).toContain(
        'RAZORPAY_KEY_SECRET must be configured with a valid secret (min 16 characters) in production'
      );
    }
  });

  it('Production: rejects when RAZORPAY_WEBHOOK_SECRET is placeholder or < 16 chars', () => {
    const result = envSchema.safeParse({
      ...baseValidProdEnv,
      RAZORPAY_WEBHOOK_SECRET: 'whsec_placeholder',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message);
      expect(issues).toContain(
        'RAZORPAY_WEBHOOK_SECRET must be configured with a valid secret (min 16 characters) in production'
      );
    }
  });

  it('Development: METRICS_TOKEN is optional', () => {
    const result = envSchema.safeParse(baseValidDevEnv);
    expect(result.success).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['shorter than 32 chars', 'short-metrics-token'],
  ])('Production: rejects when METRICS_TOKEN is %s', (_label, token) => {
    const result = envSchema.safeParse({ ...baseValidProdEnv, METRICS_TOKEN: token });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message);
      expect(issues).toContain('METRICS_TOKEN must be at least 32 characters long in production');
    }
  });

  it('Production: requires an SMTP host and rejects the memory email transport', () => {
    const missing = envSchema.safeParse({ ...baseValidProdEnv, SMTP_HOST: undefined });
    const memory = envSchema.safeParse({ ...baseValidProdEnv, EMAIL_TRANSPORT: 'memory' });
    expect(missing.success).toBe(false);
    expect(memory.success).toBe(false);
    if (!missing.success && !memory.success) {
      expect(missing.error.issues.map((i) => i.message)).toContain(
        'SMTP_HOST is required in production'
      );
      expect(memory.error.issues.map((i) => i.message)).toContain(
        'EMAIL_TRANSPORT=memory is for tests and cannot be used in production'
      );
    }
  });

  it('Production: rejects when ALLOWED_ORIGINS is missing', () => {
    const result = envSchema.safeParse({ ...baseValidProdEnv, ALLOWED_ORIGINS: undefined });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message);
      expect(issues).toContain('ALLOWED_ORIGINS is required in production');
    }
  });
});

describe('resolveAllowedOrigins', () => {
  it('splits and trims a comma-separated list', () => {
    expect(
      resolveAllowedOrigins(' https://a.example.com , https://b.example.com ', 'production')
    ).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it.each(['development', 'test'] as const)('falls back to the local frontend in %s', (nodeEnv) => {
    expect(resolveAllowedOrigins(undefined, nodeEnv)).toEqual(DEFAULT_DEV_ALLOWED_ORIGINS);
    expect(resolveAllowedOrigins('  ', nodeEnv)).toEqual(DEFAULT_DEV_ALLOWED_ORIGINS);
  });

  it('never falls back in production', () => {
    expect(resolveAllowedOrigins(undefined, 'production')).toEqual([]);
  });

  it('never allows a wildcard by default', () => {
    expect(DEFAULT_DEV_ALLOWED_ORIGINS).not.toContain('*');
    expect(DEFAULT_DEV_ALLOWED_ORIGINS).toEqual([
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
    ]);
  });
});
