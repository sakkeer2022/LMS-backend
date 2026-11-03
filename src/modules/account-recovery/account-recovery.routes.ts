import { Router } from 'express';
import { config } from '@config/index';
import { authenticate } from '@middleware/authenticate';
import { routeRateLimit } from '@middleware/rate-limit';
import { validateRequest } from '@middleware/validate';
import * as RecoveryController from './account-recovery.controller.js';
import {
  PasswordChangeDto,
  PasswordResetDto,
  RecoveryRequestDto,
  RecoveryVerifyDto,
} from './account-recovery.dto.js';

export const recoveryRouter = Router();
export const passwordRouter = Router();

const sendLimits = routeRateLimit({
  name: 'recovery-send',
  ip: {
    windowMs: config.routeRateLimit.otpSend.windowMs,
    max: config.routeRateLimit.otpSend.maxPerIp,
  },
  email: {
    windowMs: config.routeRateLimit.otpSend.windowMs,
    max: config.routeRateLimit.otpSend.maxPerEmail,
  },
});
const verifyLimits = routeRateLimit({
  name: 'recovery-verify',
  ip: {
    windowMs: config.routeRateLimit.otpVerify.windowMs,
    max: config.routeRateLimit.otpVerify.maxPerIp,
  },
});
const resetLimits = routeRateLimit({
  name: 'recovery-reset',
  ip: {
    windowMs: config.routeRateLimit.otpVerify.windowMs,
    max: config.routeRateLimit.otpVerify.maxPerIp,
  },
});
const codeLimits = routeRateLimit({
  name: 'password-change-code',
  ip: {
    windowMs: config.routeRateLimit.otpSend.windowMs,
    max: config.routeRateLimit.otpSend.maxPerIp,
  },
});
const changeLimits = routeRateLimit({
  name: 'password-change',
  ip: {
    windowMs: config.routeRateLimit.reauth.windowMs,
    max: config.routeRateLimit.reauth.maxPerIp,
  },
});

/**
 * @openapi
 * /auth/recovery/requests:
 *   post:
 *     summary: Send a password recovery code by email
 *     description: Answers the same for an unknown email, a wrong portal and an inactive account. A new request replaces the previous code and any unused reset credential; asking again inside the cooldown returns 429. The code is never in the response.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [email, portal], properties: { email: { type: string, format: email }, portal: { type: string, enum: [student, faculty, admin] } } }
 *     responses:
 *       202:
 *         description: Challenge id, expiry and the time a new code may be requested
 *       422:
 *         description: Invalid email, portal or unknown fields
 *       429:
 *         description: A code was sent a moment ago, or too many requests
 */
recoveryRouter.post(
  '/requests',
  ...sendLimits,
  validateRequest({ body: RecoveryRequestDto }),
  RecoveryController.requestRecovery
);

/**
 * @openapi
 * /auth/recovery/verify:
 *   post:
 *     summary: Exchange a recovery code for a one-time reset credential
 *     description: Wrong, expired and used codes return the same 422; running out of attempts returns 429. The credential is single use, short lived and stored only as a hash.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [challengeId, otp], properties: { challengeId: { type: string, format: uuid }, otp: { type: string, pattern: '^[0-9]{6}$' } } }
 *     responses:
 *       200:
 *         description: resetCredential and its expiry (Cache-Control no-store)
 *       422:
 *         description: Invalid, expired or used code
 *       429:
 *         description: Too many wrong codes
 */
recoveryRouter.post(
  '/verify',
  ...verifyLimits,
  validateRequest({ body: RecoveryVerifyDto }),
  RecoveryController.verifyRecovery
);

/**
 * @openapi
 * /auth/recovery/reset:
 *   post:
 *     summary: Set a new password with a reset credential
 *     description: One credential works once. Ends every session and clears the auth cookies; the person signs in again. An unchanged password returns 422.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [resetCredential, newPassword], properties: { resetCredential: { type: string }, newPassword: { type: string, format: password } } }
 *     responses:
 *       200:
 *         description: Password updated
 *       422:
 *         description: Expired, unknown or used credential, weak password, or unchanged password
 *       429:
 *         description: Too many requests
 */
recoveryRouter.post(
  '/reset',
  ...resetLimits,
  validateRequest({ body: PasswordResetDto }),
  RecoveryController.resetPassword
);

/**
 * @openapi
 * /auth/password/requests:
 *   post:
 *     summary: Send a code to your own email before changing your password
 *     description: Takes no body. A new request replaces the previous code; asking again inside the cooldown returns 429. Only accounts that must confirm a password change by email (admin and super_admin; every role when PASSWORD_CHANGE_OTP_ROLES=all) can ask, others get 422. The code works only for PUT /auth/password.
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       202:
 *         description: Challenge id, expiry and the time a new code may be requested
 *       401:
 *         description: Not signed in
 *       422:
 *         description: This account does not need an email code
 *       429:
 *         description: A code was sent a moment ago, or too many requests
 */
passwordRouter.post('/requests', authenticate, ...codeLimits, RecoveryController.requestChangeCode);

/**
 * @openapi
 * /auth/password:
 *   put:
 *     summary: Change your own password
 *     description: Checks the current password (a wrong one counts toward the account lockout), requires a different new one, ends every session including this one and clears the auth cookies. Admin accounts also send the email code from POST /auth/password/requests (challengeId and otp); a missing or wrong code returns 422.
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [currentPassword, newPassword], properties: { currentPassword: { type: string, format: password }, newPassword: { type: string, format: password }, challengeId: { type: string, format: uuid }, otp: { type: string, pattern: '^[0-9]{6}$' } } }
 *     responses:
 *       200:
 *         description: Password changed; sign in again
 *       401:
 *         description: Not signed in
 *       422:
 *         description: Wrong current password, weak or unchanged new password
 *       429:
 *         description: Too many requests or the account is locked
 */
passwordRouter.put(
  '/',
  authenticate,
  ...changeLimits,
  validateRequest({ body: PasswordChangeDto }),
  RecoveryController.changePassword
);
