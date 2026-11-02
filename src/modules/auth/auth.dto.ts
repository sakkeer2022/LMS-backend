import { z } from 'zod';

export const RegisterDto = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  fullName: z.string().min(1).max(150).trim(),
});

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

export type RegisterInput = z.infer<typeof RegisterDto>;
export type PortalLoginInput = z.infer<typeof PortalLoginDto>;
export type RefreshInput = z.infer<typeof RefreshDto>;
