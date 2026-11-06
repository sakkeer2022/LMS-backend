import { z } from 'zod';

export const CurrentPoliciesQueryDto = z.strictObject({
  country: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase()),
});

export const PolicyParamsDto = z.strictObject({ policyId: z.uuid() });

export type CurrentPoliciesQuery = z.infer<typeof CurrentPoliciesQueryDto>;

const POLICY_TYPES = [
  'terms_of_use',
  'privacy_policy',
  'child_safety_policy',
  'student_terms',
] as const;
const policyType = z
  .enum(POLICY_TYPES)
  .transform((value) => value.toUpperCase() as Uppercase<typeof value>);
const countryCode = z
  .string()
  .trim()
  .length(2)
  .transform((value) => value.toUpperCase());

export const AdminPoliciesQueryDto = z.strictObject({
  country: countryCode.optional(),
  type: policyType.optional(),
});

export const UploadPolicyDto = z.strictObject({
  type: policyType,
  country: countryCode,
  version: z
    .string()
    .trim()
    .regex(
      /^[0-9A-Za-z][0-9A-Za-z._-]{0,19}$/,
      'Use letters, numbers, dots, dashes or underscores (up to 20)'
    ),
  title: z.string().trim().min(1).max(200),
  effectiveAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Enter a valid date')
    .transform((value) => new Date(value)),
});

export type AdminPoliciesQuery = z.infer<typeof AdminPoliciesQueryDto>;
export type UploadPolicyInput = z.infer<typeof UploadPolicyDto>;
