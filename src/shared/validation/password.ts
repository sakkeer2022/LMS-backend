import { z } from 'zod';

/** bcrypt ignores everything after 72 bytes, so a longer password is rejected rather than truncated. */
export const MAX_PASSWORD_BYTES = 72;

/**
 * The platform password rule for every role (decided 2026-10-29): at least 8 characters with a number.
 * Matches the `password` schema in docs/openapi.yaml.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[0-9]/, 'Password must contain a number')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES, {
    message: 'Password must be at most 72 bytes',
  });
