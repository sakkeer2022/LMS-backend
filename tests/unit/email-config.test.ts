import { describe, it, expect } from 'vitest';
import { envSchema } from '../../src/config/index.js';

const dev = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://postgres:password@localhost:5432/amentorz_dev?schema=public',
  JWT_SECRET: 'min-32-chars-jwt-secret-for-testing-1234',
  JWT_REFRESH_SECRET: 'min-32-chars-jwt-refresh-secret-5678',
  COOKIE_SECRET: 'min-32-chars-cookie-secret-deterministic-9999',
};

const prod = {
  ...dev,
  NODE_ENV: 'production',
  ALLOWED_ORIGINS: 'https://app.amentorz.com',
  APP_BASE_URL: 'https://app.amentorz.com',
  RAZORPAY_KEY_ID: 'rzp_live_1234567890abcdef',
  RAZORPAY_KEY_SECRET: 'live_secret_key_minimum_16_chars',
  RAZORPAY_WEBHOOK_SECRET: 'live_webhook_secret_min_16_chars',
  METRICS_TOKEN: 'production-metrics-token-at-least-32-chars',
  SMTP_HOST: 'smtp.example.org',
  STORAGE_DRIVER: 's3',
  STORAGE_S3_BUCKET: 'amentorz-private',
};

function messages(input: Record<string, unknown>): string[] {
  const result = envSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe('Email and invitation configuration (LMS-79)', () => {
  it('defaults: no transport set, local app URL, 72 h invitations, 30 invites per 15 min', () => {
    const result = envSchema.parse(dev);
    expect(result.EMAIL_TRANSPORT).toBeUndefined();
    expect(result.APP_BASE_URL).toBe('http://localhost:3001');
    expect(result.SENDGRID_FROM_NAME).toBe('Amentorz');
    expect(result.FACULTY_INVITE_TTL_HOURS).toBe(72);
    expect(result.FACULTY_INVITE_RATE_LIMIT_MAX).toBe(30);
    expect(result.FACULTY_INVITE_RATE_LIMIT_WINDOW_MS).toBe(900000);
  });

  it('strips trailing slashes from APP_BASE_URL', () => {
    expect(
      envSchema.parse({ ...dev, APP_BASE_URL: 'https://app.example.com//' }).APP_BASE_URL
    ).toBe('https://app.example.com');
  });

  it('rejects a malformed APP_BASE_URL', () => {
    expect(envSchema.safeParse({ ...dev, APP_BASE_URL: 'not a url' }).success).toBe(false);
  });

  it('rejects an unknown EMAIL_TRANSPORT', () => {
    expect(envSchema.safeParse({ ...dev, EMAIL_TRANSPORT: 'smtp-ish' }).success).toBe(false);
  });

  it('requires SENDGRID_API_KEY and SENDGRID_FROM_EMAIL for the sendgrid transport', () => {
    expect(messages({ ...dev, EMAIL_TRANSPORT: 'sendgrid' })).toEqual(
      expect.arrayContaining([
        'SENDGRID_API_KEY is required when EMAIL_TRANSPORT=sendgrid',
        'SENDGRID_FROM_EMAIL is required when EMAIL_TRANSPORT=sendgrid',
      ])
    );
    expect(
      envSchema.safeParse({
        ...dev,
        EMAIL_TRANSPORT: 'sendgrid',
        SENDGRID_API_KEY: 'SG.test-key',
        SENDGRID_FROM_EMAIL: 'no-reply@amentorz.com',
      }).success
    ).toBe(true);
  });

  it('rejects a malformed SENDGRID_FROM_EMAIL', () => {
    expect(envSchema.safeParse({ ...dev, SENDGRID_FROM_EMAIL: 'no-reply' }).success).toBe(false);
  });

  it('refuses the memory transport in production', () => {
    expect(messages({ ...prod, EMAIL_TRANSPORT: 'memory' })).toContain(
      'EMAIL_TRANSPORT=memory is for tests and cannot be used in production'
    );
  });

  it('requires an https APP_BASE_URL in production', () => {
    expect(messages({ ...prod, APP_BASE_URL: 'http://app.amentorz.com' })).toContain(
      'APP_BASE_URL must use https in production'
    );
    expect(envSchema.safeParse(prod).success).toBe(true);
  });

  it('requires SMTP_HOST in production only for the smtp transport (the default)', () => {
    const { SMTP_HOST: _host, ...noSmtp } = prod;
    expect(messages(noSmtp)).toContain('SMTP_HOST is required in production');
    expect(messages({ ...noSmtp, EMAIL_TRANSPORT: 'smtp' })).toContain(
      'SMTP_HOST is required in production'
    );
    expect(
      envSchema.safeParse({
        ...noSmtp,
        EMAIL_TRANSPORT: 'sendgrid',
        SENDGRID_API_KEY: 'SG.test-key',
        SENDGRID_FROM_EMAIL: 'no-reply@amentorz.com',
      }).success
    ).toBe(true);
  });

  it.each([['0'], ['721'], ['abc']])('rejects FACULTY_INVITE_TTL_HOURS=%s', (value) => {
    expect(envSchema.safeParse({ ...dev, FACULTY_INVITE_TTL_HOURS: value }).success).toBe(false);
  });
});
