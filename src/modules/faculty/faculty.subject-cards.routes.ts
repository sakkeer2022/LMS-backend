import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import { validateRequest } from '@middleware/validate';
import * as Controller from './faculty.subject-cards.controller.js';
import {
  AdminSubjectCardParamsDto,
  RequestSubjectCardDto,
  ReviewSubjectCardDto,
  SubjectCardParamsDto,
} from './faculty.subject-cards.dto.js';

// ── Signed-in tutor: the profile's Subject Cards section (mounted at /faculty/me/subject-cards) ──

export const facultySubjectCardsRouter = Router();
facultySubjectCardsRouter.use(authenticate);

/**
 * @openapi
 * /faculty/me/subject-cards:
 *   get:
 *     summary: The tutor's subject cards
 *     description: Every active card (onboarding picks and later requests) with its approval state (pending, approved, rejected), whether it is priced and whether library resources can be managed under it, plus the card limit (5) and the slots used by pending and approved cards. Requires faculty.read_self.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ limit, used, remaining, canRequest, cards[] }" }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires faculty.read_self }
 *       404: { description: No faculty profile }
 *   post:
 *     summary: Request another subject card
 *     description: Adds a PENDING card for an offering from GET /faculty/onboarding/catalogue. The admin prices and approves it on the pricing page. 409 SUBJECT_CARD_LIMIT when the tutor already holds 5 pending or approved cards, 409 SUBJECT_CARD_EXISTS for a card the tutor already has; 403 FACULTY_NOT_APPROVED before the application is approved. Requires faculty.update_self and CSRF.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: false, required: [curriculumId], properties: { curriculumId: { type: string, format: uuid } } }
 *     responses:
 *       201: { description: The updated list of cards }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires faculty.update_self, CSRF missing, or the application is not approved }
 *       409: { description: SUBJECT_CARD_LIMIT or SUBJECT_CARD_EXISTS }
 *       422: { description: Invalid body or the subject is not offered }
 */
facultySubjectCardsRouter.get('/', requirePermission('faculty.read_self'), Controller.listMine);
facultySubjectCardsRouter.post(
  '/',
  requirePermission('faculty.update_self'),
  validateRequest({ body: RequestSubjectCardDto }),
  Controller.request
);

/**
 * @openapi
 * /faculty/me/subject-cards/{cardId}:
 *   delete:
 *     summary: Cancel a pending subject card request
 *     description: Only a pending card requested from the profile can be cancelled (409 SUBJECT_CARD_NOT_PENDING otherwise); it frees its slot. Requires faculty.update_self and CSRF.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: cardId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The updated list of cards }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires faculty.update_self, or CSRF missing }
 *       404: { description: Not one of the tutor's cards }
 *       409: { description: SUBJECT_CARD_NOT_PENDING }
 */
facultySubjectCardsRouter.delete(
  '/:cardId',
  requirePermission('faculty.update_self'),
  validateRequest({ params: SubjectCardParamsDto }),
  Controller.cancel
);

// ── Admin: approve or reject a requested card (mounted at /admin/faculty) ──

export const adminSubjectCardsRouter = Router();

/**
 * @openapi
 * /admin/faculty/{facultyId}/subject-cards/{cardId}/review:
 *   put:
 *     summary: Approve or reject a tutor's pending subject card
 *     description: Approving needs an active tutor price for the card (409 SUBJECT_CARD_NOT_PRICED) and an approved application (409 FACULTY_NOT_APPROVED); the tutor then accepts the new price before using the portal. Rejecting needs a reason and frees the slot. 409 SUBJECT_CARD_ALREADY_DECIDED for a card that is not pending. The tutor is emailed. Audited. Requires faculty.approve and CSRF.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: facultyId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: cardId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: false, required: [decision], properties: { decision: { type: string, enum: [approve, reject] }, reason: { type: string, maxLength: 1000 } } }
 *     responses:
 *       200: { description: The decided card }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires faculty.approve, or CSRF missing }
 *       404: { description: Unknown card }
 *       409: { description: SUBJECT_CARD_NOT_PRICED, SUBJECT_CARD_ALREADY_DECIDED or FACULTY_NOT_APPROVED }
 *       422: { description: Invalid body (reason required to reject) }
 */
adminSubjectCardsRouter.put(
  '/:facultyId/subject-cards/:cardId/review',
  authenticate,
  requirePermission('faculty.approve'),
  validateRequest({ params: AdminSubjectCardParamsDto, body: ReviewSubjectCardDto }),
  Controller.review
);
