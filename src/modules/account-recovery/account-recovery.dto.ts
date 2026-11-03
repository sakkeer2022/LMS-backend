import { z } from 'zod';
import { PORTALS } from '@core/security/rbac';
import { passwordSchema } from '@shared/validation/index';

export const RecoveryRequestDto = z.strictObject({
  email: z
    .string()
    .trim()
    .max(255)
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
  portal: z.enum(PORTALS),
});

export const RecoveryVerifyDto = z.strictObject({
  challengeId: z.uuid(),
  otp: z.string().regex(/^[0-9]{6}$/, 'The code is 6 digits'),
});

export const PasswordResetDto = z.strictObject({
  resetCredential: z.string().min(1).max(512),
  newPassword: passwordSchema,
});

export const PasswordChangeDto = z.strictObject({
  currentPassword: z.string().min(1).max(1024),
  newPassword: passwordSchema,
  // Required for accounts that confirm a change by email; the service decides which
  challengeId: z.uuid().optional(),
  otp: z
    .string()
    .regex(/^[0-9]{6}$/, 'The code is 6 digits')
    .optional(),
});

export type RecoveryRequest = z.infer<typeof RecoveryRequestDto>;
export type RecoveryVerify = z.infer<typeof RecoveryVerifyDto>;
export type PasswordReset = z.infer<typeof PasswordResetDto>;
export type PasswordChange = z.infer<typeof PasswordChangeDto>;
