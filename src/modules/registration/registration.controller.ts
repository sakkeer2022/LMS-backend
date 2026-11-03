import type { NextFunction, Request, Response } from 'express';
import { successResponse } from '@core/response/index';
import * as RegistrationService from './registration.service.js';
import type { RegistrationEmailRequest, RegistrationOtpVerify } from './registration.dto.js';

// Bodies are validated by validateRequest in registration.routes.ts

export async function requestEmailOtp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const challenge = await RegistrationService.requestRegistrationOtp(
      req.body as RegistrationEmailRequest
    );
    res
      .status(202)
      .json(successResponse(challenge, 'If the address can be used, a code has been sent'));
  } catch (err) {
    next(err);
  }
}

export async function verifyEmailOtp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const verified = await RegistrationService.verifyRegistrationOtp(
      req.body as RegistrationOtpVerify
    );
    res.set('Cache-Control', 'no-store');
    res.json(successResponse(verified, 'Email verified'));
  } catch (err) {
    next(err);
  }
}
