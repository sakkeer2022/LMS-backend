import { z } from 'zod';

/** POST /faculty/me/subject-cards: one offering (leaf + subject) from the onboarding catalogue. */
export const RequestSubjectCardDto = z.strictObject({
  curriculumId: z.uuid({ error: 'Pick a subject' }),
});

export const SubjectCardParamsDto = z.strictObject({ cardId: z.uuid() });

export const AdminSubjectCardParamsDto = z.strictObject({
  facultyId: z.uuid(),
  cardId: z.uuid(),
});

/** Approve (needs an active tutor price) or reject (needs a reason) a pending card. */
export const ReviewSubjectCardDto = z
  .strictObject({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(1000).optional(),
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

export type RequestSubjectCardInput = z.infer<typeof RequestSubjectCardDto>;
export type ReviewSubjectCardInput = z.output<typeof ReviewSubjectCardDto>;
