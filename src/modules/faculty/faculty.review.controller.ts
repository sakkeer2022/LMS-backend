import type { Request, Response, NextFunction } from 'express';
import { successResponse } from '@core/response/index';
import { auditContextFrom } from '@middleware/audit.middleware';
import * as Review from './faculty.review.js';
import * as Consent from './faculty.consent.js';
import * as Onboarding from './faculty.onboarding.js';
import * as Reupload from './faculty.reupload.js';
import type {
  DocumentVerificationInput,
  FacultyActiveInput,
  PriceConsentDecisionInput,
  ReviewFacultyInput,
} from './faculty.review.dto.js';
import type {
  OnboardingApplicationInput,
  ReuploadApplicationInput,
} from './faculty.onboarding.dto.js';

// Params and bodies are validated by validateRequest in the routes files

type Handler = (req: Request, res: Response) => Promise<void>;
const handle =
  (fn: Handler) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.set('Cache-Control', 'no-store');
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

const param = (req: Request, name: string): string => req.params[name] as string;

// ── Admin review (screen 27b) ──

export const getFaculty = handle(async (req, res) => {
  res.json(
    successResponse(await Review.getFacultyDetail(param(req, 'facultyId')), 'Faculty retrieved')
  );
});

export const getDocumentFile = handle(async (req, res) => {
  const file = await Review.getDocumentFile(
    param(req, 'facultyId'),
    param(req, 'documentId'),
    auditContextFrom(req)
  );
  res.set({
    'Content-Type': file.contentType,
    'Content-Length': String(file.body.length),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'X-Document-Previewable': file.previewable ? 'true' : 'false',
  });
  res.end(file.body);
});

export const setDocumentVerification = handle(async (req, res) => {
  const detail = await Review.setDocumentVerified(
    param(req, 'facultyId'),
    param(req, 'documentId'),
    req.body as DocumentVerificationInput,
    auditContextFrom(req)
  );
  res.json(successResponse(detail, 'Document updated'));
});

export const reviewFaculty = handle(async (req, res) => {
  const input = req.body as ReviewFacultyInput;
  const detail = await Review.reviewFaculty(param(req, 'facultyId'), input, auditContextFrom(req));
  res.json(
    successResponse(
      detail,
      input.decision === 'approve'
        ? 'Tutor approved'
        : input.decision === 'reject'
          ? 'Application rejected'
          : 'Re-upload requested'
    )
  );
});

export const setFacultyActive = handle(async (req, res) => {
  const input = req.body as FacultyActiveInput;
  const detail = await Review.setFacultyActive(
    param(req, 'facultyId'),
    input,
    auditContextFrom(req)
  );
  res.json(successResponse(detail, input.isActive ? 'Tutor activated' : 'Tutor deactivated'));
});

export const getConsentSignature = handle(async (req, res) => {
  const body = await Review.getConsentSignature(param(req, 'facultyId'), auditContextFrom(req));
  res.set({
    'Content-Type': 'image/png',
    'Content-Length': String(body.length),
    'Content-Disposition': 'inline; filename="signature.png"',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
  });
  res.end(body);
});

// ── Onboarding (public, invitation token) ──

export const startOnboarding = handle(async (req, res) => {
  const session = await Onboarding.startOnboarding((req.body as { token: string }).token);
  res.json(successResponse(session, 'Invitation is valid'));
});

export const onboardingCatalogue = handle(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(successResponse(await Onboarding.onboardingCatalogue(), 'Catalogue retrieved'));
});

export const onboardingTeachingModes = handle(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(successResponse(await Onboarding.onboardingTeachingModes(), 'Teaching modes retrieved'));
});

export const startReupload = handle(async (req, res) => {
  const session = await Reupload.startReupload((req.body as { token: string }).token);
  res.json(successResponse(session, 'Link is valid'));
});

export const submitReupload = handle(async (req, res) => {
  const result = await Reupload.submitReupload(
    req.body as ReuploadApplicationInput,
    (req.files ?? {}) as Onboarding.UploadedFiles,
    auditContextFrom(req)
  );
  res.json(successResponse(result, 'Application updated'));
});

export const submitApplication = handle(async (req, res) => {
  const result = await Onboarding.submitApplication(
    req.body as OnboardingApplicationInput,
    (req.files ?? {}) as Onboarding.UploadedFiles,
    auditContextFrom(req)
  );
  res.status(201).json(successResponse(result, 'Application submitted'));
});

// ── Faculty self-service (faculty portal) ──

export const getPriceConsent = handle(async (req, res) => {
  res.json(
    successResponse(await Consent.getPriceConsent(req.user?.sub as string), 'Prices retrieved')
  );
});

export const decidePriceConsent = handle(async (req, res) => {
  const input = req.body as PriceConsentDecisionInput;
  const view = await Consent.decidePriceConsent(
    req.user?.sub as string,
    input,
    auditContextFrom(req),
    req.file?.buffer
  );
  res.json(
    successResponse(view, input.decision === 'accept' ? 'Prices accepted' : 'Prices declined')
  );
});
