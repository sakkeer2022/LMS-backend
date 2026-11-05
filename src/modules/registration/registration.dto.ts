import { z } from 'zod';
import { completedYears, parseCalendarDate } from '@shared/dates';

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

const fullName = z.string().trim().min(1).max(150);
const mobile = z.string().regex(/^\+[1-9][0-9]{7,14}$/, 'Enter the number with its country code');
const uuidList = (min: number, max: number): z.ZodArray<z.ZodUUID> =>
  z
    .array(z.uuid())
    .min(min)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, 'Entries must not repeat');

const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const GuardianDto = z.strictObject({
  fullName,
  relationship: z.enum(['father', 'mother', 'legal_guardian', 'grandparent', 'sibling', 'other']),
  mobileNumber: mobile,
  email: z
    .string()
    .trim()
    .max(255)
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
  receivesReportsAndReceipts: z.boolean(),
});

const LearningProfileDto = z.strictObject({
  // Offerings from any branch of the tree: academic and non-academic can be mixed
  curriculumIds: uuidList(1, 50),
  teachingLanguageId: z.uuid().nullable().optional(),
});

/** The four onboarding steps in one request. Unknown fields (role, isActive, permissions) are a 422. */
export const RegisterStudentDto = z.strictObject({
  emailVerificationToken: z.string().min(1).max(512),
  fullName,
  dateOfBirth: z
    .string()
    .refine((value) => parseCalendarDate(value) !== null, 'Enter a valid date of birth')
    .refine((value) => {
      const years = completedYears(value, new Date());
      return years !== null && years >= 0 && years <= 120;
    }, 'Enter a valid date of birth'),
  mobileNumber: mobile,
  // bcrypt reads only the first 72 bytes, so a longer password would be silently cut
  password: z
    .string()
    .min(8)
    .regex(/[0-9]/, 'Use at least one number')
    .refine((value) => Buffer.byteLength(value) <= 72, 'Use at most 72 bytes'),
  timezone: z.string().min(1).max(64).refine(isTimeZone, 'Enter an IANA time zone'),
  learningProfile: LearningProfileDto,
  guardian: GuardianDto.optional(),
  consentToken: z.string().min(1).max(512).optional(),
  acceptedPolicyIds: uuidList(2, 4),
});

export type RegisterStudentInput = z.infer<typeof RegisterStudentDto>;
