import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { config } from '@config/index';
import { ValidationError } from '@core/errors/index';
import { authenticate, requirePermission } from '@middleware/authenticate';
import { validateRequest } from '@middleware/validate';
import { createRouteRateLimiter } from '@middleware/rate-limit';
import * as Controller from './faculty.review.controller.js';
import { DOCUMENT_UPLOAD_FIELDS, MAX_UPLOAD_FILES } from './faculty.documents.js';
import {
  OnboardingApplicationDto,
  OnboardingSessionDto,
  ReuploadApplicationDto,
  ReuploadSessionDto,
} from './faculty.onboarding.dto.js';
import { PriceConsentDecisionDto } from './faculty.review.dto.js';

// The drawn signature sent with "accept" (multipart, one PNG in `signature`); JSON bodies pass through
const signatureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.consent.signatureMaxBytes, files: 1, fields: 5, parts: 6 },
}).single('signature');

function parseSignature(req: Request, res: Response, next: NextFunction): void {
  signatureUpload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'The signature image is too large'
          : 'The signing form could not be read';
      return next(
        new ValidationError(message, {
          code: 'SIGNATURE_REQUIRED',
          fieldErrors: { signature: [message] },
        })
      );
    }
    next(err);
  });
}

// ── Public onboarding from the invitation link (screens 43b-43e) ──

export const facultyOnboardingRouter = Router();

const onboardingRateLimit = createRouteRateLimiter({
  name: 'faculty-onboarding',
  windowMs: config.facultyOnboarding.rateLimitWindowMs,
  max: config.facultyOnboarding.rateLimitMax,
  keyBy: 'ip',
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

const documentsUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxBytes,
    files: MAX_UPLOAD_FILES,
    fields: 25,
    fieldSize: 16 * 1024,
  },
}).fields(DOCUMENT_UPLOAD_FIELDS);

/** Multer errors become 422s naming the file field, so the page can show them inline. */
function parseDocuments(req: Request, res: Response, next: NextFunction): void {
  documentsUpload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const field = err.field ?? 'documents';
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `The file is larger than ${Math.round(config.upload.maxBytes / 1048576)} MB`
          : err.code === 'LIMIT_UNEXPECTED_FILE'
            ? err.field === 'additionalDocuments'
              ? 'Too many additional documents'
              : 'Unexpected file'
            : 'The upload could not be read';
      return next(
        new ValidationError(message, {
          code: 'DOCUMENT_INVALID',
          fieldErrors: { [field]: [message] },
        })
      );
    }
    next(err);
  });
}

/**
 * @openapi
 * /faculty/onboarding/session:
 *   post:
 *     summary: Check a faculty invitation link
 *     description: Returns the invited email and the link expiry. Every unusable link (unknown, used, revoked or expired) returns the same 422 INVITATION_INVALID. Public; CSRF required; rate-limited per IP.
 *     tags: [Faculty onboarding]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: false, required: [token], properties: { token: { type: string, pattern: '^[A-Za-z0-9_-]{43}$' } } }
 *     responses:
 *       200: { description: "{ email, expiresAt }" }
 *       403: { description: CSRF token missing }
 *       422: { description: INVITATION_INVALID or malformed token }
 *       429: { description: Rate limit reached }
 */
facultyOnboardingRouter.post(
  '/session',
  onboardingRateLimit,
  validateRequest({ body: OnboardingSessionDto }),
  Controller.startOnboarding
);

/**
 * @openapi
 * /faculty/onboarding/catalogue:
 *   get:
 *     summary: Category tree and offerings for the subject picker (screen 43c)
 *     description: Visible categories that lead to a bookable leaf, and each leaf's active offerings (board, level, subject). Public catalogue data.
 *     tags: [Faculty onboarding]
 *     responses:
 *       200: { description: "{ nodes[], offerings[] }" }
 */
facultyOnboardingRouter.get('/catalogue', Controller.onboardingCatalogue);

/**
 * @openapi
 * /faculty/onboarding/teaching-modes:
 *   get:
 *     summary: Preferred mode of teaching options (screen 43b)
 *     description: Active rows of teaching_modes in display order (online, offline, hybrid). Public reference data.
 *     tags: [Faculty onboarding]
 *     responses:
 *       200: { description: "[{ code, name, offersOffline }]" }
 */
facultyOnboardingRouter.get('/teaching-modes', Controller.onboardingTeachingModes);

/**
 * @openapi
 * /faculty/onboarding/applications:
 *   post:
 *     summary: Submit a faculty application (screens 43b-43d)
 *     description: >
 *       multipart/form-data. Text fields token, fullName, password, confirmPassword, mobileNumber (E.164),
 *       city, highestQualification, teachingExperience (0-1, 1-3, 3-5, 5-10, 10+), studiedAt,
 *       curriculumIds (JSON array of curriculum ids), offersOfflineClasses ("true"/"false"),
 *       declarationAccepted ("true"); files photoId, degreeCertificate and panCard (PDF, DOC, DOCX,
 *       PPT, PPTX, JPG or PNG, checked by signature, up to UPLOAD_MAX_BYTES each). One transaction
 *       consumes the invitation and creates the user (faculty role, email verified), profile,
 *       subject assignments and documents. The tutor cannot sign in until approved and priced.
 *       Public; CSRF required; rate-limited per IP.
 *     tags: [Faculty onboarding]
 *     responses:
 *       201: { description: "{ applicationReference, fullName, email, submittedAt }" }
 *       403: { description: CSRF token missing }
 *       409: { description: ALREADY_REGISTERED }
 *       422: { description: Field errors, DOCUMENT_INVALID or INVITATION_INVALID }
 *       429: { description: Rate limit reached }
 */
facultyOnboardingRouter.post(
  '/applications',
  onboardingRateLimit,
  parseDocuments,
  validateRequest({ body: OnboardingApplicationDto }),
  Controller.submitApplication
);

/**
 * @openapi
 * /faculty/onboarding/reupload/session:
 *   post:
 *     summary: Check a re-upload link and return the tutor's application
 *     description: >
 *       The link an admin sends with "Request re-upload". Returns the email, the admin's reason, the link
 *       expiry, the answers and subjects on file, and the documents on file (to pre-fill the form). Every
 *       unusable link (unknown, used, superseded or expired) returns the same 422 REUPLOAD_LINK_INVALID.
 *       Public; CSRF required; rate-limited per IP.
 *     tags: [Faculty onboarding]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: false, required: [token], properties: { token: { type: string, pattern: '^[A-Za-z0-9_-]{43}$' } } }
 *     responses:
 *       200: { description: "{ email, expiresAt, reason, applicationReference, values, curriculumIds, documents[] }" }
 *       403: { description: CSRF token missing }
 *       422: { description: REUPLOAD_LINK_INVALID or malformed token }
 *       429: { description: Rate limit reached }
 */
facultyOnboardingRouter.post(
  '/reupload/session',
  onboardingRateLimit,
  validateRequest({ body: ReuploadSessionDto }),
  Controller.startReupload
);

/**
 * @openapi
 * /faculty/onboarding/reupload:
 *   post:
 *     summary: Submit a corrected application from a re-upload link
 *     description: >
 *       multipart/form-data. The application's text fields without the password (token, fullName,
 *       mobileNumber, city, highestQualification, teachingExperience, teachingMode, studiedAt, curriculumIds,
 *       declarationAccepted) plus removeDocumentIds (JSON array of additional documents to remove). Files
 *       photoId, degreeCertificate and panCard are optional (one left out keeps the file on record);
 *       additionalDocuments up to 5. Consumes the link and puts the application back to PENDING ("New").
 *       Public; CSRF required; rate-limited per IP.
 *     tags: [Faculty onboarding]
 *     responses:
 *       200: { description: "{ applicationReference, fullName, email, submittedAt }" }
 *       403: { description: CSRF token missing }
 *       422: { description: Field errors, DOCUMENT_INVALID or REUPLOAD_LINK_INVALID }
 *       429: { description: Rate limit reached }
 */
facultyOnboardingRouter.post(
  '/reupload',
  onboardingRateLimit,
  parseDocuments,
  validateRequest({ body: ReuploadApplicationDto }),
  Controller.submitReupload
);

// ── Faculty self-service (signed-in tutor) ──

export const facultySelfRouter = Router();
facultySelfRouter.use(authenticate);

/**
 * @openapi
 * /faculty/me/price-consent:
 *   get:
 *     summary: The tutor's session prices awaiting acceptance
 *     description: Every subject the tutor teaches with its price, the snapshot hash to send back, and the current decision (required, accepted or rejected). 403 FACULTY_PENDING_PRICING until approved and fully priced. Requires faculty.read_self.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ status, decidedAt, snapshotHash, subjects[] }" }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires faculty.read_self, or prices not ready }
 *       404: { description: No faculty profile }
 *   post:
 *     summary: Accept or decline the session prices
 *     description: Records the decision for the exact prices shown (snapshotHash); 409 PRICES_CHANGED if they changed since. Accepting is multipart/form-data with the drawn signature as a PNG in `signature` (422 SIGNATURE_REQUIRED without it); declining may be JSON. Declining keeps the portal blocked and emails the approving admin. Requires faculty.update_self and CSRF.
 *     tags: [Faculty]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: false, required: [decision, snapshotHash], properties: { decision: { type: string, enum: [accept, reject] }, snapshotHash: { type: string, pattern: '^[0-9a-f]{64}$' } } }
 *         multipart/form-data:
 *           schema: { type: object, required: [decision, snapshotHash, signature], properties: { decision: { type: string, enum: [accept, reject] }, snapshotHash: { type: string, pattern: '^[0-9a-f]{64}$' }, signature: { type: string, format: binary } } }
 *     responses:
 *       200: { description: The recorded decision }
 *       401: { description: Missing or invalid token }
 *       403: { description: Requires faculty.update_self, CSRF missing, or prices not ready }
 *       409: { description: PRICES_CHANGED }
 *       422: { description: Invalid body }
 */
facultySelfRouter.get(
  '/price-consent',
  requirePermission('faculty.read_self'),
  Controller.getPriceConsent
);
facultySelfRouter.post(
  '/price-consent',
  requirePermission('faculty.update_self'),
  parseSignature,
  validateRequest({ body: PriceConsentDecisionDto }),
  Controller.decidePriceConsent
);
