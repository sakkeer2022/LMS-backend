import { z } from 'zod';

export const FacultyIdParamsDto = z.strictObject({ facultyId: z.uuid() });
export const FacultyDocumentParamsDto = z.strictObject({
  facultyId: z.uuid(),
  documentId: z.uuid(),
});

export const DocumentVerificationDto = z.strictObject({ isVerified: z.boolean() });

/** Screen 27b: "Verify & publish" or "Reject". */
export const ReviewFacultyDto = z
  .strictObject({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(1000).optional(),
    // "Publish profile to discovery once verified"
    publish: z.boolean().default(false),
    expectedRevision: z.number().int().min(1),
  })
  .superRefine((dto, ctx) => {
    if (dto.decision === 'reject' && !dto.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Give a reason for the rejection',
      });
    }
  });

export const PriceConsentDecisionDto = z.strictObject({
  decision: z.enum(['accept', 'reject']),
  snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type DocumentVerificationInput = z.infer<typeof DocumentVerificationDto>;
export type ReviewFacultyInput = z.output<typeof ReviewFacultyDto>;
export type PriceConsentDecisionInput = z.infer<typeof PriceConsentDecisionDto>;
