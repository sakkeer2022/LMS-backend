import { z } from 'zod';
import { completedYears, parseCalendarDate } from '@shared/dates';

const fullName = z.string().trim().min(1).max(150);

/** The text fields of the signing request (the signature image arrives as the `signature` file part). */
export const SignConsentDto = z
  .strictObject({
    policyId: z.uuid(),
    studentFullName: fullName,
    studentDateOfBirth: z
      .string()
      .refine((value) => parseCalendarDate(value) !== null, 'Enter a valid date of birth')
      .refine((value) => {
        const years = completedYears(value, new Date());
        return years !== null && years >= 0 && years <= 120;
      }, 'Enter a valid date of birth'),
    signatureMode: z.enum(['draw', 'type']),
    typedName: fullName.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.signatureMode === 'type' && !value.typedName) {
      ctx.addIssue({ code: 'custom', path: ['typedName'], message: 'Type the name to sign with' });
    }
    if (value.signatureMode === 'draw' && value.typedName) {
      ctx.addIssue({
        code: 'custom',
        path: ['typedName'],
        message: 'A drawn signature has no typed name',
      });
    }
  });

export const ConsentTokenHeaderDto = z.object({ 'x-consent-token': z.string().min(1).max(512) });

export const StudentIdParamsDto = z.strictObject({ studentId: z.uuid() });

export type SignConsentInput = z.infer<typeof SignConsentDto>;
