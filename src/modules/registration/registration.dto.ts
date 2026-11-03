import { z } from 'zod';

export const RegistrationEmailRequestDto = z.strictObject({
  email: z
    .string()
    .trim()
    .max(255)
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
});

export const RegistrationOtpVerifyDto = z.strictObject({
  challengeId: z.uuid(),
  otp: z.string().regex(/^[0-9]{6}$/, 'The code is 6 digits'),
});

export type RegistrationEmailRequest = z.infer<typeof RegistrationEmailRequestDto>;
export type RegistrationOtpVerify = z.infer<typeof RegistrationOtpVerifyDto>;
