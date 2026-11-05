import type { NextFunction, Request, Response } from 'express';
import { successResponse } from '@core/response/index';
import { auditContextFrom } from '@middleware/audit.middleware';
import { logAction } from '../audit/audit.service.js';
import * as ConsentService from './consent.service.js';
import type { SignConsentInput } from './consent.dto.js';

// Bodies, headers and params are validated by validateRequest in consent.routes.ts

function sendPdf(res: Response, file: ConsentService.ConsentFile): void {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="guardian-consent.pdf"',
    // A signed consent is personal: never cached by the browser or a shared cache
    'Cache-Control': 'private, no-store',
    ETag: `"${file.sha256}"`,
  });
  res.send(file.bytes);
}

export async function sign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const receipt = await ConsentService.signGuardianConsent(
      req.body as SignConsentInput,
      req.file?.buffer,
      { ipAddress: req.ip ?? 'unknown', userAgent: req.get('User-Agent') ?? null }
    );
    res.set('Cache-Control', 'no-store');
    res.status(201).json(successResponse(receipt, 'Consent signed'));
  } catch (err) {
    next(err);
  }
}

export async function pendingFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendPdf(res, await ConsentService.getPendingConsentFile(req.get('x-consent-token') as string));
  } catch (err) {
    next(err);
  }
}

export async function ownFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendPdf(res, await ConsentService.getOwnConsentFile(req.user!.sub));
  } catch (err) {
    next(err);
  }
}

export async function adminSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const summary = await ConsentService.getConsentSummary(req.params['studentId'] as string);
    res.set('Cache-Control', 'private, no-store');
    res.json(successResponse(summary, 'Consent retrieved'));
  } catch (err) {
    next(err);
  }
}

export async function adminFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = await ConsentService.getStudentConsentFile(req.params['studentId'] as string);
    await logAction({
      ...auditContextFrom(req),
      actorId: req.user!.sub,
      severity: 'SECURITY',
      entity: 'guardian_consent',
      action: 'consent.downloaded',
      resourceId: file.consentId,
    });
    sendPdf(res, file);
  } catch (err) {
    next(err);
  }
}
