import { Router } from 'express';
import { config } from '@config/index';
import { authenticate, requirePermission } from '@middleware/authenticate';
import { validateRequest } from '@middleware/validate';
import { createRouteRateLimiter } from '@middleware/rate-limit';
import * as Controller from './library.controller.js';
import {
  CreateResourceDto,
  ResourceParamsDto,
  ReviewSubmissionDto,
  SubmissionParamsDto,
  UpdateResourceDto,
} from './library.dto.js';
import { parseResourceUpload } from './library.files.js';

// ── Faculty library (mounted at /faculty/me/library) ──

export const facultyLibraryRouter = Router();
facultyLibraryRouter.use(authenticate, requirePermission('library.manage_self'));

const uploadRateLimit = createRouteRateLimiter({
  name: 'library-upload',
  windowMs: config.library.uploadRateLimitWindowMs,
  max: config.library.uploadRateLimitMax,
  keyBy: 'user',
  message: 'Too many uploads. Please wait a few minutes and try again.',
});

/**
 * @openapi
 * /faculty/me/library:
 *   get:
 *     summary: The tutor's library overview
 *     description: Every subject card of the tutor (as GET /faculty/me/subject-cards) with libraryEnabled and resource counts (approved, inReview, rejected). Resources can be managed only under cards with libraryEnabled (approved, active and priced). Requires library.manage_self.
 *     tags: [Faculty library]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ cards[] }" }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires library.manage_self }
 *       404: { description: No faculty profile }
 */
facultyLibraryRouter.get('/', Controller.overview);

/**
 * @openapi
 * /faculty/me/library/resources:
 *   get:
 *     summary: Resources under one of the tutor's subject cards
 *     description: Withdrawn resources are left out. Each resource has reviewState (pending, rejected, approved, edit_pending, edit_rejected), the edit waiting for review and the latest decision with the admin's notes. 404 when the tutor has no such card. Requires library.manage_self.
 *     tags: [Faculty library]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: curriculumId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Resources, newest first }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires library.manage_self }
 *       404: { description: Not one of the tutor's cards }
 *       422: { description: Invalid query }
 *   post:
 *     summary: Add a resource (pending review)
 *     description: multipart/form-data. kind file needs one file (PDF, JPG, PNG, DOC, DOCX, PPT, PPTX; checked by signature; UPLOAD_MAX_BYTES); kind note needs body (plain text, up to 20,000 characters). The card must be approved and active (403 SUBJECT_CARD_NOT_ACTIVE). The resource stays pending until an admin approves it. Rate-limited per tutor. Requires library.manage_self and CSRF.
 *     tags: [Faculty library]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema: { type: object, required: [curriculumId, kind, title], properties: { curriculumId: { type: string, format: uuid }, kind: { type: string, enum: [file, note] }, title: { type: string, minLength: 2, maxLength: 150 }, description: { type: string, maxLength: 1000 }, body: { type: string, maxLength: 20000 }, file: { type: string, format: binary } } }
 *     responses:
 *       201: { description: The resource }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires library.manage_self, CSRF missing, or SUBJECT_CARD_NOT_ACTIVE }
 *       422: { description: RESOURCE_INVALID or invalid fields }
 *       429: { description: Rate limit reached }
 */
facultyLibraryRouter.get('/resources', Controller.listResources);
facultyLibraryRouter.post(
  '/resources',
  uploadRateLimit,
  parseResourceUpload,
  validateRequest({ body: CreateResourceDto }),
  Controller.createResource
);

/**
 * @openapi
 * /faculty/me/library/resources/{resourceId}:
 *   put:
 *     summary: Edit a resource (reviewed again)
 *     description: multipart/form-data with the whole resource (kind, title, description, body, optional file; a file resource without a new file keeps its file). Before the first approval the resource shows the edit and stays pending; once approved, the edit waits for review and the approved version stays live. A newer edit replaces one that is still waiting. 403 SUBJECT_CARD_NOT_ACTIVE when the card is not active. Rate-limited per tutor. Requires library.manage_self and CSRF.
 *     tags: [Faculty library]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: resourceId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema: { type: object, required: [kind, title], properties: { kind: { type: string, enum: [file, note] }, title: { type: string, minLength: 2, maxLength: 150 }, description: { type: string, maxLength: 1000 }, body: { type: string, maxLength: 20000 }, file: { type: string, format: binary } } }
 *     responses:
 *       200: { description: The resource }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires library.manage_self, CSRF missing, or SUBJECT_CARD_NOT_ACTIVE }
 *       404: { description: Not one of the tutor's resources }
 *       422: { description: RESOURCE_INVALID or invalid fields }
 *       429: { description: Rate limit reached }
 *   delete:
 *     summary: Withdraw a resource
 *     description: Hides the resource from the tutor, the review queue and students; a waiting edit is withdrawn too. Files are kept for the audit trail. The card must be active. Requires library.manage_self and CSRF.
 *     tags: [Faculty library]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: resourceId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Withdrawn }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires library.manage_self, CSRF missing, or SUBJECT_CARD_NOT_ACTIVE }
 *       404: { description: Not one of the tutor's resources }
 */
facultyLibraryRouter.put(
  '/resources/:resourceId',
  uploadRateLimit,
  validateRequest({ params: ResourceParamsDto }),
  parseResourceUpload,
  validateRequest({ body: UpdateResourceDto }),
  Controller.updateResource
);
facultyLibraryRouter.delete(
  '/resources/:resourceId',
  validateRequest({ params: ResourceParamsDto }),
  Controller.withdrawResource
);

/**
 * @openapi
 * /faculty/me/library/resources/{resourceId}/file:
 *   get:
 *     summary: Download the tutor's own file
 *     description: version=live (default) is the file the resource shows; version=pending is the file of the edit waiting for review. Sent as an attachment (no-store, nosniff, sandbox CSP; X-Document-Previewable for PDF and images). Requires library.manage_self.
 *     tags: [Faculty library]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: resourceId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: version, required: false, schema: { type: string, enum: [live, pending] } }
 *     responses:
 *       200: { description: The file }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires library.manage_self }
 *       404: { description: No such resource or file }
 */
facultyLibraryRouter.get(
  '/resources/:resourceId/file',
  validateRequest({ params: ResourceParamsDto }),
  Controller.resourceFile
);

// ── Admin review (mounted at /admin/library) ──

export const adminLibraryRouter = Router();
adminLibraryRouter.use(authenticate);

// One permission for the queue and the decisions, as in the earlier library draft contract
const moderate = requirePermission('library.moderate');

/**
 * @openapi
 * /admin/library:
 *   get:
 *     summary: Library submissions from tutors
 *     description: One row per submission (a new resource or an edit) with the tutor, the subject card and the content. status pending (default, oldest first), approved, rejected or all (decided newest first). q searches the title and the tutor's name or email. Requires library.moderate.
 *     tags: [Library]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, required: false, schema: { type: string, enum: [pending, approved, rejected, all] } }
 *       - { in: query, name: q, required: false, schema: { type: string, maxLength: 100 } }
 *       - { in: query, name: facultyId, required: false, schema: { type: string, format: uuid } }
 *       - { in: query, name: page, required: false, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: limit, required: false, schema: { type: integer, minimum: 1, maximum: 100 } }
 *     responses:
 *       200: { description: Submissions with pagination meta }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires library.moderate }
 *       422: { description: Invalid query }
 */
adminLibraryRouter.get('/', moderate, Controller.listSubmissions);

/**
 * @openapi
 * /admin/library/counts:
 *   get:
 *     summary: Submission counts per status
 *     description: "{ pending, approved, rejected } for the tab badges; q and facultyId filter as in the list. Requires library.moderate."
 *     tags: [Library]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, required: false, schema: { type: string, maxLength: 100 } }
 *       - { in: query, name: facultyId, required: false, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Counts }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires library.moderate }
 */
adminLibraryRouter.get('/counts', moderate, Controller.submissionCounts);

/**
 * @openapi
 * /admin/library/{submissionId}:
 *   get:
 *     summary: One submission
 *     description: The submission with its description and note text, the live version it would replace (for an edit) and the resource's history. Requires library.moderate.
 *     tags: [Library]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: submissionId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The submission }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires library.moderate }
 *       404: { description: Unknown submission }
 */
adminLibraryRouter.get(
  '/:submissionId',
  moderate,
  validateRequest({ params: SubmissionParamsDto }),
  Controller.getSubmission
);

/**
 * @openapi
 * /admin/library/{submissionId}/content:
 *   get:
 *     summary: The submitted (or live) file
 *     description: version=submitted (default) or live. Attachment with no-store, nosniff and a sandbox CSP; X-Document-Previewable for PDF and images. Audited. Requires library.moderate.
 *     tags: [Library]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: submissionId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: version, required: false, schema: { type: string, enum: [submitted, live] } }
 *     responses:
 *       200: { description: The file }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires library.moderate }
 *       404: { description: No such submission or file }
 */
adminLibraryRouter.get(
  '/:submissionId/content',
  moderate,
  validateRequest({ params: SubmissionParamsDto }),
  Controller.submissionFile
);

/**
 * @openapi
 * /admin/library/{submissionId}/review:
 *   put:
 *     summary: Approve or reject a submission
 *     description: Approving makes the submission the live version (409 SUBJECT_CARD_NOT_ACTIVE when the tutor's card is no longer approved and active). Rejecting needs a reason; a resource never approved becomes rejected, a live one keeps its approved version. 409 SUBMISSION_ALREADY_DECIDED for a submission that is not pending (including one replaced by a newer edit). Audited. Requires library.moderate and CSRF.
 *     tags: [Library]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: submissionId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: false, required: [status], properties: { status: { type: string, enum: [approved, rejected] }, reason: { type: string, maxLength: 1000 } } }
 *     responses:
 *       200: { description: The decided submission }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires library.moderate, or CSRF missing }
 *       404: { description: Unknown submission }
 *       409: { description: SUBMISSION_ALREADY_DECIDED or SUBJECT_CARD_NOT_ACTIVE }
 *       422: { description: Invalid body (reason required to reject) }
 */
adminLibraryRouter.put(
  '/:submissionId/review',
  moderate,
  validateRequest({ params: SubmissionParamsDto, body: ReviewSubmissionDto }),
  Controller.reviewSubmission
);
