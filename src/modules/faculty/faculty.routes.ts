import { Router } from 'express';
import { config } from '@config/index';
import { authenticate, requirePermission } from '@middleware/authenticate';
import { validateRequest } from '@middleware/validate';
import { createRouteRateLimiter } from '@middleware/rate-limit';
import * as FacultyController from './faculty.controller.js';
import { FacultyCountsQueryDto, InviteFacultyDto, ListFacultyQueryDto } from './faculty.dto.js';
import * as ReviewController from './faculty.review.controller.js';
import {
  DocumentVerificationDto,
  FacultyDocumentParamsDto,
  FacultyIdParamsDto,
  ReviewFacultyDto,
} from './faculty.review.dto.js';

export const adminFacultyRouter = Router();

adminFacultyRouter.use(authenticate);

// Each admin has their own budget, so one admin cannot exhaust another's
const inviteRateLimit = createRouteRateLimiter({
  name: 'faculty-invite',
  windowMs: config.facultyInvitations.rateLimitWindowMs,
  max: config.facultyInvitations.rateLimitMax,
  keyBy: 'user',
  message: 'Too many invitations. Please wait before inviting more tutors.',
});

/**
 * @openapi
 * /admin/faculty:
 *   get:
 *     summary: List tutors and outstanding invitations (admin Faculty screen)
 *     description: >
 *       One row per faculty profile or PENDING invitation, with a derived status
 *       (invited, expired, pending, verified, published, rejected, suspended).
 *       status selects a tab: pending = invited + pending; all includes rejected and expired.
 *       categoryId keeps tutors with an active assignment in that category's subtree and
 *       hides invitations. Requires faculty.read. Cache-Control no-store.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [all, pending, verified, published, suspended], default: all } }
 *       - { in: query, name: search, schema: { type: string, maxLength: 100 }, description: Name or email contains (case-insensitive) }
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - { in: query, name: sort, schema: { type: string, enum: [recent, oldest, name], default: recent } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200:
 *         description: Roster page with pagination meta
 *       401:
 *         description: Missing or invalid token
 *       403:
 *         description: Requires faculty.read
 *       422:
 *         description: Invalid filter, unknown category or unknown query parameter
 */
adminFacultyRouter.get(
  '/',
  requirePermission('faculty.read'),
  validateRequest({ query: ListFacultyQueryDto }),
  FacultyController.listFaculty
);

/**
 * @openapi
 * /admin/faculty/status-counts:
 *   get:
 *     summary: Tab badge counts for the admin Faculty screen
 *     description: Counts for all, pending, verified, published and suspended, narrowed by the same search and categoryId as the list. Requires faculty.read.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: search, schema: { type: string, maxLength: 100 } }
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: "{ all, pending, verified, published, suspended }"
 *       401:
 *         description: Missing or invalid token
 *       403:
 *         description: Requires faculty.read
 *       422:
 *         description: Invalid filter or unknown category
 */
adminFacultyRouter.get(
  '/status-counts',
  requirePermission('faculty.read'),
  validateRequest({ query: FacultyCountsQueryDto }),
  FacultyController.getStatusCounts
);

/**
 * @openapi
 * /admin/faculty/invitations:
 *   post:
 *     summary: Invite tutors by email
 *     description: >
 *       Creates one single-use invitation per email (1-20, trimmed, lowercased, duplicates
 *       removed; RFC 5322 dot-atom addresses). The link is
 *       APP_BASE_URL/faculty/onboarding?token=..., valid for FACULTY_INVITE_TTL_HOURS; only
 *       the token's SHA-256 hash is stored. All or nothing: if any address already has an
 *       account or a pending invitation, nothing is created and 409 lists each conflict in
 *       errors.emails. delivery=email sends the emails through the configured provider; an
 *       undeliverable invitation is revoked and reported with delivered=false, and 502 is
 *       returned when none could be sent. delivery=link (exactly one email) sends nothing
 *       and returns inviteUrl once ("Copy link"). Requires faculty.create and CSRF;
 *       rate-limited per admin. Every invitation is audited.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [emails]
 *             properties:
 *               emails: { type: array, minItems: 1, maxItems: 20, items: { type: string, format: email, maxLength: 254 } }
 *               delivery: { type: string, enum: [email, link], default: email }
 *     responses:
 *       201:
 *         description: Invitations created; data.invitations[] and data.inviteUrl (link delivery only)
 *       401:
 *         description: Missing or invalid token
 *       403:
 *         description: Requires faculty.create, or CSRF token missing
 *       409:
 *         description: FACULTY_INVITE_CONFLICT, an address is registered or already invited
 *       422:
 *         description: Missing, malformed or too many emails, or unknown fields
 *       429:
 *         description: Invite rate limit reached; see Retry-After
 *       502:
 *         description: EMAIL_DELIVERY_FAILED, no invitation email could be sent
 */
adminFacultyRouter.post(
  '/invitations',
  requirePermission('faculty.create'),
  inviteRateLimit,
  validateRequest({ body: InviteFacultyDto }),
  FacultyController.inviteFaculty
);

// ── Verification (screen 27b, LMS-39) ──

/**
 * @openapi
 * /admin/faculty/{facultyId}:
 *   get:
 *     summary: One tutor's application for the verification drawer
 *     description: Profile and screening answers, documents (with verification state), the subjects chosen at onboarding with their current tutor price, and the pricing/consent state. Requires faculty.read.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: facultyId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The application }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires faculty.read }
 *       404: { description: Unknown faculty profile }
 */
adminFacultyRouter.get(
  '/:facultyId',
  requirePermission('faculty.read'),
  validateRequest({ params: FacultyIdParamsDto }),
  ReviewController.getFaculty
);

/**
 * @openapi
 * /admin/faculty/{facultyId}/documents/{documentId}/file:
 *   get:
 *     summary: Download a tutor verification document
 *     description: The stored bytes, as an attachment with Cache-Control private no-store, nosniff and a sandbox CSP. X-Document-Previewable says whether the admin app may show it inline (PDF and images). Every access is audited. Requires faculty.documents.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: facultyId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: documentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: File bytes }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires faculty.documents }
 *       404: { description: Unknown document for this tutor }
 */
adminFacultyRouter.get(
  '/:facultyId/documents/:documentId/file',
  requirePermission('faculty.documents'),
  validateRequest({ params: FacultyDocumentParamsDto }),
  ReviewController.getDocumentFile
);

/**
 * @openapi
 * /admin/faculty/{facultyId}/documents/{documentId}/verification:
 *   put:
 *     summary: Mark a verification document as verified (or not)
 *     description: Requires faculty.approve and CSRF. Audited.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: facultyId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: documentId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: false, required: [isVerified], properties: { isVerified: { type: boolean } } }
 *     responses:
 *       200: { description: The updated application }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires faculty.approve, or CSRF token missing }
 *       404: { description: Unknown document for this tutor }
 *       422: { description: Invalid body }
 */
adminFacultyRouter.put(
  '/:facultyId/documents/:documentId/verification',
  requirePermission('faculty.approve'),
  validateRequest({ params: FacultyDocumentParamsDto, body: DocumentVerificationDto }),
  ReviewController.setDocumentVerification
);

/**
 * @openapi
 * /admin/faculty/{facultyId}/review:
 *   put:
 *     summary: Approve ("Verify & publish") or reject a tutor application
 *     description: >
 *       Only pending applications can be decided (409 INVALID_TRANSITION). Approve verifies the
 *       remaining documents and sets isPublished to publish; reject needs a reason and unpublishes.
 *       expectedRevision must match (409 STALE_REVISION). The tutor is emailed. Approval alone does
 *       not allow sign-in: every subject needs a tutor price first. Requires faculty.approve and CSRF.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: facultyId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [decision, expectedRevision]
 *             properties:
 *               decision: { type: string, enum: [approve, reject] }
 *               reason: { type: string, maxLength: 1000 }
 *               publish: { type: boolean, default: false }
 *               expectedRevision: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: The updated application }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires faculty.approve, or CSRF token missing }
 *       404: { description: Unknown faculty profile }
 *       409: { description: INVALID_TRANSITION or STALE_REVISION }
 *       422: { description: Missing reason or invalid body }
 */
adminFacultyRouter.put(
  '/:facultyId/review',
  requirePermission('faculty.approve'),
  validateRequest({ params: FacultyIdParamsDto, body: ReviewFacultyDto }),
  ReviewController.reviewFaculty
);
