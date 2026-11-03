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
