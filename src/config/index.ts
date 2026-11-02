import dotenv from 'dotenv';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

import { z } from 'zod';
import ms from 'ms';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    API_PREFIX: z.string().default('/api/v1'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
    JWT_EXPIRES_IN: z
      .string()
      .default('15m')
      .refine((val) => typeof ms(val as Parameters<typeof ms>[0]) === 'number', {
        message: 'Invalid format for JWT_EXPIRES_IN. Must be parseable by ms (e.g., "15m")',
      }),
    JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
    JWT_REFRESH_EXPIRES_IN: z
      .string()
      .default('7d')
      .refine((val) => typeof ms(val as Parameters<typeof ms>[0]) === 'number', {
        message: 'Invalid format for JWT_REFRESH_EXPIRES_IN. Must be parseable by ms (e.g., "7d")',
      }),

    LOG_LEVEL: z.string().default('info'),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

    // Per-route limits (src/middleware/rate-limit.ts), on top of the global limit above
    LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    LOGIN_RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().positive().default(20),
    LOGIN_RATE_LIMIT_MAX_PER_EMAIL: z.coerce.number().int().positive().default(10),
    REFRESH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    REFRESH_RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().positive().default(60),

    REDIS_URL: z.string().default('redis://localhost:6379'),

    MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
    LOCKOUT_DURATION_MINUTES: z.coerce.number().int().positive().default(15),

    COOKIE_SECRET: z.string().min(1, 'COOKIE_SECRET is required'),

    ALLOWED_ORIGINS: z.string().optional(),

    RAZORPAY_KEY_ID: z.string().default('rzp_test_placeholder'),
    RAZORPAY_KEY_SECRET: z.string().default('rzp_secret_placeholder'),
    RAZORPAY_WEBHOOK_SECRET: z.string().default('whsec_placeholder'),
    AWS_REGION: z.string().default('us-east-1'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
    METRICS_TOKEN: z.string().optional(),
    AWS_S3_BUCKET: z.string().default('rbac-uploads-quarantine'),
    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10485760), // 10MB
    CLAMAV_ENABLED: z
      .preprocess((val) => val === 'true' || val === true, z.boolean())
      .default(false),
    CLAMAV_HOST: z.string().default('localhost'),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.JWT_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'JWT_SECRET must be at least 32 characters long in production',
          path: ['JWT_SECRET'],
        });
      }
      if (env.JWT_REFRESH_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'JWT_REFRESH_SECRET must be at least 32 characters long in production',
          path: ['JWT_REFRESH_SECRET'],
        });
      }
      if (env.COOKIE_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'COOKIE_SECRET must be at least 32 characters long in production',
          path: ['COOKIE_SECRET'],
        });
      }
      if (!env.ALLOWED_ORIGINS || env.ALLOWED_ORIGINS.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ALLOWED_ORIGINS is required in production',
          path: ['ALLOWED_ORIGINS'],
        });
      }
      if (!env.METRICS_TOKEN || env.METRICS_TOKEN.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'METRICS_TOKEN must be at least 32 characters long in production',
          path: ['METRICS_TOKEN'],
        });
      }
      if (
        !env.RAZORPAY_KEY_ID.startsWith('rzp_live_') ||
        env.RAZORPAY_KEY_ID === 'rzp_test_placeholder'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'RAZORPAY_KEY_ID must be configured with a live key (rzp_live_...) in production',
          path: ['RAZORPAY_KEY_ID'],
        });
      }
      if (
        env.RAZORPAY_KEY_SECRET === 'rzp_secret_placeholder' ||
        env.RAZORPAY_KEY_SECRET.length < 16
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'RAZORPAY_KEY_SECRET must be configured with a valid secret (min 16 characters) in production',
          path: ['RAZORPAY_KEY_SECRET'],
        });
      }
      if (
        env.RAZORPAY_WEBHOOK_SECRET === 'whsec_placeholder' ||
        env.RAZORPAY_WEBHOOK_SECRET.length < 16
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'RAZORPAY_WEBHOOK_SECRET must be configured with a valid secret (min 16 characters) in production',
          path: ['RAZORPAY_WEBHOOK_SECRET'],
        });
      }
    }
  });

export { envSchema };

// Local frontend origin(s) allowed when ALLOWED_ORIGINS is not set outside production.
export const DEFAULT_DEV_ALLOWED_ORIGINS = ['http://localhost:3001'];

/** Parses ALLOWED_ORIGINS. Outside production an empty value falls back to the local frontend. */
export function resolveAllowedOrigins(
  raw: string | undefined,
  nodeEnv: 'development' | 'production' | 'test'
): string[] {
  const origins = (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '');
  if (origins.length === 0 && nodeEnv !== 'production') return [...DEFAULT_DEV_ALLOWED_ORIGINS];
  return origins;
}

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error(
    '❌ Invalid environment variables:',
    JSON.stringify(parsedEnv.error.format(), null, 2)
  );
  process.exit(1);
}

const env = parsedEnv.data;

export const config = {
  env: env.NODE_ENV,
  port: env.PORT,
  apiPrefix: env.API_PREFIX,

  databaseUrl: env.DATABASE_URL,

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    refreshSecret: env.JWT_REFRESH_SECRET,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  },

  log: {
    level: env.LOG_LEVEL,
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
  },

  routeRateLimit: {
    login: {
      windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
      maxPerIp: env.LOGIN_RATE_LIMIT_MAX_PER_IP,
      maxPerEmail: env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL,
    },
    refresh: {
      windowMs: env.REFRESH_RATE_LIMIT_WINDOW_MS,
      maxPerIp: env.REFRESH_RATE_LIMIT_MAX_PER_IP,
    },
  },

  redis: {
    url: env.REDIS_URL,
  },

  security: {
    maxFailedLogins: env.MAX_FAILED_LOGINS,
    lockoutDurationMinutes: env.LOCKOUT_DURATION_MINUTES,
    cookieSecret: env.COOKIE_SECRET,
    allowedOrigins: resolveAllowedOrigins(env.ALLOWED_ORIGINS, env.NODE_ENV),
  },

  razorpay: {
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  },

  aws: {
    region: env.AWS_REGION,
    s3Bucket: env.AWS_S3_BUCKET,
  },

  upload: {
    maxBytes: env.UPLOAD_MAX_BYTES,
  },

  clamav: {
    enabled: env.CLAMAV_ENABLED,
    host: env.CLAMAV_HOST,
    port: env.CLAMAV_PORT,
  },

  otel: {
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  },

  metrics: {
    token: env.METRICS_TOKEN,
  },
} as const;

export type Config = typeof config;
