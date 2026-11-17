import { z } from 'zod';
import { passwordSchema } from '@shared/validation/index';
import { MAX_SUBJECT_CARDS, SUBJECT_CARD_LIMIT_MESSAGE } from './faculty.subject-cards.rules.js';

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

/** Onboarding (and re-upload) may pick at most the subject card limit. */
export const MAX_ONBOARDING_SUBJECTS = MAX_SUBJECT_CARDS;

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
      // Duplicates are ignored before the limit is checked
      .transform((ids) => [...new Set(ids)])
      .refine((ids) => ids.length <= MAX_ONBOARDING_SUBJECTS, {
        message: `${SUBJECT_CARD_LIMIT_MESSAGE}. Pick at most ${MAX_ONBOARDING_SUBJECTS} subjects`,
      })
  );

/** Teaching mode code ("Preferred mode of teaching"); checked against teaching_modes by the service. */
export const teachingModeSchema = z
  .string({ error: 'Select your preferred mode of teaching' })
  .trim()
  .toLowerCase()
  .regex(/^[a-z_]{2,20}$/, 'Select your preferred mode of teaching');

/**
 * The phone number with its country code. The form may send it as "+91 98765 43210"; spaces, dashes and
 * brackets are removed before the E.164 check, so the stored value is always "+919876543210".
 */
export const mobileNumberSchema = z
  .string({ error: 'Phone number is required' })
  .transform((value) => value.replace(/[\s().-]/g, ''))
  .pipe(
    z
      .string()
      .regex(
        /^\+[1-9][0-9]{7,14}$/,
        'Enter the phone number with its country code, e.g. +91 98765 43210'
      )
  );

/** Answers shared by the first application and a re-upload (screens 43b-43d). */
const profileFields = {
  fullName: z
    .string({ error: 'Full name is required' })
    .trim()
    .min(2, 'Enter your full name')
    .max(150, 'Full name must be at most 150 characters'),
  mobileNumber: mobileNumberSchema,
  city: optionalText(100),
  highestQualification: z
    .string({ error: 'Highest qualification is required' })
    .trim()
    .min(2, 'Enter your highest qualification')
    .max(150, 'Must be at most 150 characters'),
  teachingExperience: z.enum(TEACHING_EXPERIENCE, { error: 'Select a range' }),
  teachingMode: teachingModeSchema,
  studiedAt: optionalText(200),
  curriculumIds,
  // Replaced by teachingMode (derived from it); still accepted from older clients and ignored
  offersOfflineClasses: formBoolean.optional(),
  declarationAccepted: z.literal('true', {
    error: 'Confirm these documents are yours and accept the tutor terms',
  }),
};

/** The text fields of POST /faculty/onboarding/applications (screens 43b-43d). */
export const OnboardingApplicationDto = z
  .strictObject({
    token: inviteTokenSchema,
    password: passwordSchema,
    confirmPassword: z.string({ error: 'Confirm your password' }),
    ...profileFields,
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

// ── Re-upload after an admin's request ──

/** Re-upload link token: same shape as an invitation token. */
export const reuploadTokenSchema = z
  .string({ error: 'The link is missing its token' })
  .regex(/^[A-Za-z0-9_-]{43}$/, 'The link is invalid');

export const ReuploadSessionDto = z.strictObject({ token: reuploadTokenSchema });

/** JSON list of the tutor's additional documents to remove ("[]" when none). */
const removeDocumentIds = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return [] as unknown;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'The list of documents to remove is invalid' });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(z.uuid())
      .max(20)
      .transform((ids) => [...new Set(ids)])
  );

/**
 * The text fields of POST /faculty/onboarding/reupload: the same answers as the application, without a
 * password (the account exists). Files are optional: a required document left out keeps the one on file.
 */
export const ReuploadApplicationDto = z.strictObject({
  token: reuploadTokenSchema,
  ...profileFields,
  removeDocumentIds,
});

export type ReuploadApplicationInput = z.output<typeof ReuploadApplicationDto>;
