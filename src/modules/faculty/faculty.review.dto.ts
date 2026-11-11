import { z } from 'zod';

export const FacultyIdParamsDto = z.strictObject({ facultyId: z.uuid() });
export const FacultyDocumentParamsDto = z.strictObject({
  facultyId: z.uuid(),
  documentId: z.uuid(),
});

export const DocumentVerificationDto = z.strictObject({ isVerified: z.boolean() });

/**
 * Screen 27b: "Verify & publish", "Request re-upload" (a temporary rejection: the tutor is emailed the
 * reason and a link to correct the application) or "Reject" (final).
 */
export const REVIEW_DECISIONS = ['approve', 'reject', 'request_reupload'] as const;

export const ReviewFacultyDto = z
  .strictObject({
    decision: z.enum(REVIEW_DECISIONS),
    reason: z.string().trim().max(1000).optional(),
    // "Publish profile to discovery once verified"
    publish: z.boolean().default(false),
    expectedRevision: z.number().int().min(1),
  })
  .superRefine((dto, ctx) => {
    if (dto.decision !== 'approve' && !dto.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message:
          dto.decision === 'reject'
            ? 'Give a reason for the rejection'
            : 'Tell the tutor what to correct or re-upload',
      });
    }
  });

/** Activate or deactivate a tutor (operational control, separate from verification). */
export const FacultyActiveDto = z.strictObject({ isActive: z.boolean() });

/** Multipart or JSON: accepting also sends the drawn signature as a PNG in the `signature` part. */
export const PriceConsentDecisionDto = z.strictObject({
  decision: z.enum(['accept', 'reject']),
  snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type DocumentVerificationInput = z.infer<typeof DocumentVerificationDto>;
export type ReviewFacultyInput = z.output<typeof ReviewFacultyDto>;
export type PriceConsentDecisionInput = z.infer<typeof PriceConsentDecisionDto>;
export type FacultyActiveInput = z.infer<typeof FacultyActiveDto>;
