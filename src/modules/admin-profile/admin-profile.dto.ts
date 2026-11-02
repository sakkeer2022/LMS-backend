import { z } from 'zod';

/** Valid IANA zone names, checked by the runtime's own time zone database. */
function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// Replaces the three editable fields. Email is read-only: changing it needs email verification (LMS-99)
export const AdminProfileUpdateDto = z
  .object({
    fullName: z.string().trim().min(1, 'Full name is required').max(150),
    mobileNumber: z
      .string()
      .regex(/^\+[1-9][0-9]{7,14}$/, 'Enter the number in international format, e.g. +919876543210')
      .nullable(),
    timezone: z.string().max(64).refine(isTimeZone, 'Unknown time zone').nullable(),
  })
  .strict();

export type AdminProfileUpdateInput = z.infer<typeof AdminProfileUpdateDto>;
