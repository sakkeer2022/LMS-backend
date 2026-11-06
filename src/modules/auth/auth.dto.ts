import { z } from 'zod';

// Portal logins reject unknown fields; the password is only length-bounded, never re-validated
export const PortalLoginDto = z
  .object({
    email: z.string().trim().email().max(255).toLowerCase(),
    password: z.string().min(1, 'Password is required').max(1024),
    rememberMe: z.boolean().optional().default(false),
  })
  .strict();

export const ReauthenticateDto = z
  .object({ password: z.string().min(1, 'Password is required').max(1024) })
  .strict();

export const RefreshDto = z.object({
  refreshToken: z.string().optional(),
});

export type PortalLoginInput = z.infer<typeof PortalLoginDto>;
export type RefreshInput = z.infer<typeof RefreshDto>;
