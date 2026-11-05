import { Router } from 'express';
import { config } from '@config/index';
import { authenticate, requirePermission, requireRole } from '@middleware/authenticate';
import { requireRecentReauth } from '@middleware/require-reauth';
import { routeRateLimit } from '@middleware/rate-limit';
import { validateRequest } from '@middleware/validate';
import * as ConsentController from './consent.controller.js';
import { ConsentTokenHeaderDto, SignConsentDto, StudentIdParamsDto } from './consent.dto.js';
import { signatureUpload } from './consent.upload.js';

/** Public: signing before the account exists, and the download for whoever holds the consent token. */
export const consentRouter = Router();
/** The signed-in student's own consent. */
export const studentConsentRouter = Router();
/** The admin's view of a student's consent. */
export const adminConsentRouter = Router();

const signLimits = routeRateLimit({
  name: 'consent-sign',
  ip: {
    windowMs: config.routeRateLimit.consentSign.windowMs,
    max: config.routeRateLimit.consentSign.maxPerIp,
  },
});

/**
 * @openapi
 * /consent/guardian-signatures:
 *   post:
 *     summary: Sign the Student Terms as parent or guardian
 *     description: Opened after the email is verified when the student's age is below the country's consent age, before the account exists. Multipart form; the signature is a PNG in the `signature` part (draw) or a typed name. The consent age comes from the country of the policy being signed. 422 when the age is at or above it, the policy is not the current Student Terms, or the mode and fields disagree. Strict per-IP rate limit. The consent is deleted with its PDF if it is not used within CONSENT_UNLINKED_TTL_HOURS.
 *     tags: [Consent]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema: { type: object, required: [policyId, studentFullName, studentDateOfBirth, signatureMode], properties: { policyId: { type: string, format: uuid }, studentFullName: { type: string }, studentDateOfBirth: { type: string, format: date }, signatureMode: { type: string, enum: [draw, type] }, signature: { type: string, format: binary }, typedName: { type: string } } }
 *     responses:
 *       201:
 *         description: A single-use consent token and the receipt
 *       413:
 *         description: The signature image is too large
 *       422:
 *         description: Age, policy or signature does not fit
 *       429:
 *         description: Too many signing requests
 */
consentRouter.post(
  '/guardian-signatures',
  ...signLimits,
  signatureUpload,
  validateRequest({ body: SignConsentDto }),
  ConsentController.sign
);

/**
 * @openapi
 * /consent/guardian-signatures/file:
 *   get:
 *     summary: Download the signed consent before registration
 *     description: Only the holder of an unexpired, unlinked consent token (header `x-consent-token`, never a URL). 404 for unknown, expired or linked tokens. Does not use the token up. Private, no-store; attachment.
 *     tags: [Consent]
 *     parameters:
 *       - { in: header, name: x-consent-token, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: The signed PDF
 *       404:
 *         description: Unknown, expired or linked token
 *       503:
 *         description: The file is not available in storage
 */
consentRouter.get(
  '/guardian-signatures/file',
  validateRequest({ headers: ConsentTokenHeaderDto }),
  ConsentController.pendingFile
);

/**
 * @openapi
 * /students/me/guardian-consent/file:
 *   get:
 *     summary: Download your own signed consent
 *     tags: [Consent]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: The signed PDF (private, no-store)
 *       401:
 *         description: Not signed in
 *       403:
 *         description: Not a student
 *       404:
 *         description: No consent on record
 */
studentConsentRouter.get(
  '/guardian-consent/file',
  authenticate,
  requireRole('student'),
  ConsentController.ownFile
);

/**
 * @openapi
 * /admin/students/{studentId}/guardian-consent:
 *   get:
 *     summary: Show a student's signed consent record
 *     description: Metadata of the guardian consent of an under-18 student; the PDF is a separate download. studentId is the student profile id. Requires student.read.
 *     tags: [Consent]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: The consent record
 *       401:
 *         description: Not signed in
 *       403:
 *         description: Requires student.read
 *       404:
 *         description: The student has no consent
 * /admin/students/{studentId}/guardian-consent/file:
 *   get:
 *     summary: Download a student's signed consent
 *     description: Requires student.read and recent reauthentication. Audited. Private, no-store.
 *     tags: [Consent]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: The signed PDF
 *       403:
 *         description: Requires student.read or recent reauthentication
 *       404:
 *         description: The student has no consent
 */
adminConsentRouter.get(
  '/:studentId/guardian-consent',
  authenticate,
  requirePermission('student.read'),
  validateRequest({ params: StudentIdParamsDto }),
  ConsentController.adminSummary
);
adminConsentRouter.get(
  '/:studentId/guardian-consent/file',
  authenticate,
  requirePermission('student.read'),
  requireRecentReauth,
  validateRequest({ params: StudentIdParamsDto }),
  ConsentController.adminFile
);
