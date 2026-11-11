import type { NextFunction, Request, Response } from 'express';
import { successResponse } from '@core/response/index';
import { auditContextFrom } from '@middleware/audit.middleware';
import { requestPortal } from '@core/security/portal-cookies';
import { clearTokenCookies } from '@modules/auth/index.js';
import * as RecoveryService from './account-recovery.service.js';
import type {
  PasswordChange,
  PasswordReset,
  RecoveryRequest,
  RecoveryVerify,
} from './account-recovery.dto.js';

// Bodies are validated by validateRequest in account-recovery.routes.ts

export async function requestRecovery(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const challenge = await RecoveryService.requestRecovery(req.body as RecoveryRequest);
    res
      .status(202)
      .json(successResponse(challenge, 'If the account can be recovered, a code has been sent'));
  } catch (err) {
    next(err);
  }
}

export async function verifyRecovery(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const grant = await RecoveryService.verifyRecovery(req.body as RecoveryVerify);
    res.set('Cache-Control', 'no-store');
    res.json(successResponse(grant, 'Code verified'));
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await RecoveryService.resetPassword(req.body as PasswordReset, auditContextFrom(req));
    clearTokenCookies(res, requestPortal(req));
    res.set('Cache-Control', 'no-store');
    res.json(successResponse(null, 'Password updated. Sign in with your new password.'));
  } catch (err) {
    next(err);
  }
}

export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await RecoveryService.changePassword(
      req.user!.sub,
      req.body as PasswordChange,
      auditContextFrom(req)
    );
    clearTokenCookies(res, requestPortal(req));
    res.set('Cache-Control', 'no-store');
    res.json(successResponse(null, 'Password changed. Sign in again with your new password.'));
  } catch (err) {
    next(err);
  }
}

export async function requestChangeCode(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const challenge = await RecoveryService.requestPasswordChangeCode(req.user!.sub);
    res.status(202).json(successResponse(challenge, 'A code has been sent to your email'));
  } catch (err) {
    next(err);
  }
}
