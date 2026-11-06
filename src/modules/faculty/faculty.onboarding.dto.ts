import { z } from 'zod';
import { passwordSchema } from '@shared/validation/index';

/** "Years of teaching" options (screen 43b). Codes are stored; labels are the UI's. */
export const TEACHING_EXPERIENCE = ['0-1', '1-3', '3-5', '5-10', '10+'] as const;
export type TeachingExperience = (typeof TEACHING_EXPERIENCE)[number];

export const TEACHING_EXPERIENCE_LABELS: Record<TeachingExperience, string> = {
  '0-1': 'Less than 1 year',
  '1-3': '1–3 years',
  '3-5': '3–5 years',
  '5-10': '5–10 years',
  '10+': 'More than 10 years',
};

export const MAX_ONBOARDING_SUBJECTS = 30;

/** Invitation token from the email link: 43 base64url characters. */
export const inviteTokenSchema = z
  .string({ error: 'The invitation link is missing its token' })
  .regex(/^[A-Za-z0-9_-]{43}$/, 'The invitation link is invalid');

export const OnboardingSessionDto = z.strictObject({ token: inviteTokenSchema });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .transform((value) => (value ? value : null));

/** Multipart form fields are strings: booleans arrive as "true"/"false", lists as JSON. */
const formBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

const curriculumIds = z
  .string({ error: 'Pick at least one subject' })
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Pick at least one subject' });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(z.uuid('Unknown subject'))
      .min(1, 'Pick at least one subject')
      .max(MAX_ONBOARDING_SUBJECTS, `Pick at most ${MAX_ONBOARDING_SUBJECTS} subjects`)
      .transform((ids) => [...new Set(ids)])
  );

/** The text fields of POST /faculty/onboarding/applications (screens 43b-43d). */
export const OnboardingApplicationDto = z
  .strictObject({
    token: inviteTokenSchema,
    fullName: z
      .string({ error: 'Full name is required' })
      .trim()
      .min(2, 'Enter your full name')
      .max(150, 'Full name must be at most 150 characters'),
    password: passwordSchema,
    confirmPassword: z.string({ error: 'Confirm your password' }),
    mobileNumber: z
      .string({ error: 'Phone number is required' })
      .trim()
      .regex(
        /^\+[1-9][0-9]{7,14}$/,
        'Enter the phone number with its country code, e.g. +91 98765 43210'
      ),
    city: optionalText(100),
    highestQualification: z
      .string({ error: 'Highest qualification is required' })
      .trim()
      .min(2, 'Enter your highest qualification')
      .max(150, 'Must be at most 150 characters'),
    teachingExperience: z.enum(TEACHING_EXPERIENCE, { error: 'Select a range' }),
    studiedAt: optionalText(200),
    curriculumIds,
    offersOfflineClasses: formBoolean.default(false),
    declarationAccepted: z.literal('true', {
      error: 'Confirm these documents are yours and accept the tutor terms',
    }),
  })
  .superRefine((dto, ctx) => {
    if (dto.password !== dto.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords do not match',
      });
    }
  });

export type OnboardingApplicationInput = z.output<typeof OnboardingApplicationDto>;
