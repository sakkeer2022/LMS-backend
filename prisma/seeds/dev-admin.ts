import { z } from 'zod';

/**
 * Settings for the local development admin (npm run db:seed:users). Pure, so the
 * production guard is unit tested. Both flags must agree: APP_ENV=development is the
 * explicit opt-in, and NODE_ENV=production always refuses.
 */
const DevAdminEnvDto = z.object({
  APP_ENV: z.string().optional(),
  NODE_ENV: z.string().optional(),
  DEV_ADMIN_EMAIL: z.email().default('admin@local.test'),
  DEV_ADMIN_PASSWORD: z
    .string({ error: 'Set DEV_ADMIN_PASSWORD in .env (at least 12 characters)' })
    .min(12, 'DEV_ADMIN_PASSWORD must be at least 12 characters'),
  DEV_ADMIN_NAME: z.string().trim().min(1).max(150).default('Local Admin'),
});

export interface DevAdminSettings {
  email: string;
  password: string;
  fullName: string;
}

export function parseDevAdminEnv(env: Record<string, string | undefined>): DevAdminSettings {
  // Empty values in .env count as unset, so the documented defaults apply
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = DevAdminEnvDto.parse(cleaned);
  if (parsed.NODE_ENV === 'production') {
    throw new Error('Refusing to seed the development admin when NODE_ENV=production');
  }
  if (parsed.APP_ENV !== 'development') {
    throw new Error('The development admin is seeded only when APP_ENV=development');
  }
  return {
    email: parsed.DEV_ADMIN_EMAIL.toLowerCase(),
    password: parsed.DEV_ADMIN_PASSWORD,
    fullName: parsed.DEV_ADMIN_NAME,
  };
}
