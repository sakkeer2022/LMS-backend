import { describe, it, expect } from 'vitest';
import { envSchema } from '../../src/config/index.js';

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
    RAZORPAY_KEY_ID: 'rzp_live_1234567890abcdef',
    RAZORPAY_KEY_SECRET: 'live_secret_key_minimum_16_chars',
    RAZORPAY_WEBHOOK_SECRET: 'live_webhook_secret_min_16_chars',
    METRICS_TOKEN: 'production-metrics-token-at-least-32-chars',
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
      expect(issues).toContain('RAZORPAY_KEY_ID must be configured with a live key (rzp_live_...) in production');
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
      expect(issues).toContain('RAZORPAY_KEY_ID must be configured with a live key (rzp_live_...) in production');
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
      expect(issues).toContain('RAZORPAY_KEY_SECRET must be configured with a valid secret (min 16 characters) in production');
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
      expect(issues).toContain('RAZORPAY_WEBHOOK_SECRET must be configured with a valid secret (min 16 characters) in production');
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
});
