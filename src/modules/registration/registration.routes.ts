import { Router } from 'express';
import { validateRequest } from '@middleware/validate';
import * as RegistrationController from './registration.controller.js';
import { RegistrationEmailRequestDto, RegistrationOtpVerifyDto } from './registration.dto.js';

export const registrationRouter = Router();

/**
 * @openapi
 * /auth/registration/email-otp/requests:
 *   post:
 *     summary: Send a registration OTP to an email before the account exists
 *     description: Onboarding step 1. Answers the same for an address that already has an account. A new request replaces the previous code; asking again inside the cooldown returns 429. The code is never in the response.
 *     tags: [Registration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [email], properties: { email: { type: string, format: email } } }
 *     responses:
 *       202:
 *         description: Challenge id, expiry and the time a new code may be requested
 *       422:
 *         description: Invalid email or unknown fields
 *       429:
 *         description: A code was sent a moment ago
 */
registrationRouter.post(
  '/email-otp/requests',
  validateRequest({ body: RegistrationEmailRequestDto }),
  RegistrationController.requestEmailOtp
);

/**
 * @openapi
 * /auth/registration/email-otp/verify:
 *   post:
 *     summary: Verify the registration OTP and receive an email verification token
 *     description: Wrong, expired and used codes all return the same 422; running out of attempts returns 429. The token is single use and its hash is the only copy stored.
 *     tags: [Registration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [challengeId, otp], properties: { challengeId: { type: string, format: uuid }, otp: { type: string, pattern: '^[0-9]{6}$' } } }
 *     responses:
 *       200:
 *         description: emailVerificationToken and its expiry (Cache-Control no-store)
 *       422:
 *         description: Invalid, expired or used code
 *       429:
 *         description: Too many wrong codes
 */
registrationRouter.post(
  '/email-otp/verify',
  validateRequest({ body: RegistrationOtpVerifyDto }),
  RegistrationController.verifyEmailOtp
);
