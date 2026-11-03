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

    // Lifetime of a sign-in without "keep me signed in"; its cookie also ends with the browser session
    JWT_SESSION_EXPIRES_IN: z
      .string()
      .default('12h')
      .refine((val) => typeof ms(val as Parameters<typeof ms>[0]) === 'number', {
        message: 'Invalid format for JWT_SESSION_EXPIRES_IN. Must be parseable by ms (e.g., "12h")',
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

    // Email one-time codes: sending a code (per IP and per email) and checking one (per IP)
    OTP_SEND_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    OTP_SEND_RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().positive().default(10),
    OTP_SEND_RATE_LIMIT_MAX_PER_EMAIL: z.coerce.number().int().positive().default(5),
    OTP_VERIFY_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    OTP_VERIFY_RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().positive().default(30),

    // Password confirmation for sensitive actions (POST /auth/reauthenticate)
    REAUTH_WINDOW_MINUTES: z.coerce.number().int().positive().default(5),
    REAUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
    REAUTH_RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().positive().default(30),

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

    // Guardian consent (signed in the date-of-birth popup before the account exists)
    CONSENT_UNLINKED_TTL_HOURS: z.coerce.number().int().positive().default(24),
    CONSENT_SIGNATURE_MAX_BYTES: z.coerce.number().int().positive().default(1048576),
    CONSENT_SIGN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(3600000),
    CONSENT_SIGN_RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().positive().default(10),
    POLICY_MAX_BYTES: z.coerce.number().int().positive().default(10485760),
    // Reverse proxies in front of the app (0 = none). Needed so the client IP in consents and audit is the
    // real one, never the first X-Forwarded-For entry.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

    // File storage for signed consents and policy PDFs (src/infrastructure/storage). `local` and `memory` are
    // for development and tests; production uses a private S3 bucket of its own.
    STORAGE_DRIVER: z.enum(['local', 's3', 'memory']).optional(),
    STORAGE_LOCAL_DIR: z.string().default('.data/storage'),
    STORAGE_S3_BUCKET: z.string().optional(),
    STORAGE_S3_REGION: z.string().optional(),
    STORAGE_S3_PREFIX: z.string().default(''),

    // Email: one interface, transport chosen here. `memory` keeps messages in process (tests only).
    EMAIL_TRANSPORT: z.enum(['smtp', 'memory']).optional(),
    EMAIL_FROM: z.string().default('Amentorz <no-reply@amentorz.local>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    // One-time passwords sent by email (the code is always 6 digits, see the contract)
    OTP_EXPIRES_MINUTES: z.coerce.number().int().positive().default(10),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    EMAIL_TOKEN_EXPIRES_MINUTES: z.coerce.number().int().positive().default(30),
    // Who must confirm a password change with an email code: admin and super_admin accounts, or every role
    PASSWORD_CHANGE_OTP_ROLES: z.enum(['admin', 'all']).default('admin'),
    RESET_GRANT_EXPIRES_MINUTES: z.coerce.number().int().positive().default(5),
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
      if (env.STORAGE_DRIVER !== 's3') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'STORAGE_DRIVER must be s3 in production',
          path: ['STORAGE_DRIVER'],
        });
      }
      if (!env.STORAGE_S3_BUCKET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'STORAGE_S3_BUCKET is required in production',
          path: ['STORAGE_S3_BUCKET'],
        });
      }
      if (env.EMAIL_TRANSPORT === 'memory') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'EMAIL_TRANSPORT=memory is for tests and cannot be used in production',
          path: ['EMAIL_TRANSPORT'],
        });
      }
      if (!env.SMTP_HOST) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SMTP_HOST is required in production',
          path: ['SMTP_HOST'],
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
export const DEFAULT_DEV_ALLOWED_ORIGINS = [
  'http://localhost:3001', // admin
  'http://localhost:3002', // student
  'http://localhost:3003', // faculty
];

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
    sessionExpiresIn: env.JWT_SESSION_EXPIRES_IN,
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
    reauth: {
      windowMs: env.REAUTH_RATE_LIMIT_WINDOW_MS,
      maxPerIp: env.REAUTH_RATE_LIMIT_MAX_PER_IP,
    },
    otpSend: {
      windowMs: env.OTP_SEND_RATE_LIMIT_WINDOW_MS,
      maxPerIp: env.OTP_SEND_RATE_LIMIT_MAX_PER_IP,
      maxPerEmail: env.OTP_SEND_RATE_LIMIT_MAX_PER_EMAIL,
    },
    consentSign: {
      windowMs: env.CONSENT_SIGN_RATE_LIMIT_WINDOW_MS,
      maxPerIp: env.CONSENT_SIGN_RATE_LIMIT_MAX_PER_IP,
    },
    otpVerify: {
      windowMs: env.OTP_VERIFY_RATE_LIMIT_WINDOW_MS,
      maxPerIp: env.OTP_VERIFY_RATE_LIMIT_MAX_PER_IP,
    },
  },

  redis: {
    url: env.REDIS_URL,
  },

  consent: {
    unlinkedTtlHours: env.CONSENT_UNLINKED_TTL_HOURS,
    signatureMaxBytes: env.CONSENT_SIGNATURE_MAX_BYTES,
    policyMaxBytes: env.POLICY_MAX_BYTES,
  },

  trustProxyHops: env.TRUST_PROXY_HOPS,

  storage: {
    driver:
      env.STORAGE_DRIVER ?? (env.NODE_ENV === 'test' ? ('memory' as const) : ('local' as const)),
    localDir: env.STORAGE_LOCAL_DIR,
    s3: {
      bucket: env.STORAGE_S3_BUCKET,
      region: env.STORAGE_S3_REGION ?? env.AWS_REGION,
      prefix: env.STORAGE_S3_PREFIX,
    },
  },

  email: {
    transport:
      env.EMAIL_TRANSPORT ?? (env.NODE_ENV === 'test' ? ('memory' as const) : ('smtp' as const)),
    from: env.EMAIL_FROM,
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  },

  otp: {
    expiresMinutes: env.OTP_EXPIRES_MINUTES,
    resendCooldownSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
    maxAttempts: env.OTP_MAX_ATTEMPTS,
    emailTokenExpiresMinutes: env.EMAIL_TOKEN_EXPIRES_MINUTES,
    resetGrantExpiresMinutes: env.RESET_GRANT_EXPIRES_MINUTES,
    passwordChangeOtpRoles: env.PASSWORD_CHANGE_OTP_ROLES,
  },

  security: {
    maxFailedLogins: env.MAX_FAILED_LOGINS,
    lockoutDurationMinutes: env.LOCKOUT_DURATION_MINUTES,
    reauthWindowMinutes: env.REAUTH_WINDOW_MINUTES,
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
