import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { routeRateLimit } from '@middleware/rate-limit';
import { config } from '@config/index';
import { PORTALS } from '@core/security/rbac';
import * as AuthController from './auth.controller.js';
import { portalLogin } from './portal-login.controller.js';

export const authRouter = Router();

/**
 * @openapi
 * /auth/csrf-token:
 *   get:
 *     summary: Get CSRF token
 *     tags: [Auth]
 */
authRouter.get('/csrf-token', AuthController.getCsrfToken);

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: Successfully registered
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         user:
 *                           type: object
 *       400:
 *         description: Validation Error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
authRouter.post('/register', AuthController.register);

/**
 * @openapi
 * /auth/student/login:
 *   post:
 *     summary: Log in to the student portal
 *     tags: [Auth]
 *     description: Email and password; the account must hold the student role. Wrong portal, unknown, locked or inactive accounts all return the same 401. Unverified email returns 403. Rate limited per IP and per email.
 *     responses:
 *       200:
 *         description: Signed in; access and refresh cookies set
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Email not verified, or CSRF failure
 *       429:
 *         description: Too many attempts
 * /auth/faculty/login:
 *   post:
 *     summary: Log in to the faculty portal
 *     tags: [Auth]
 *     description: Same behaviour as the student login, for the faculty role.
 * /auth/admin/login:
 *   post:
 *     summary: Log in to the admin portal
 *     tags: [Auth]
 *     description: Same behaviour as the student login, for the admin and super_admin roles.
 */
const loginLimits = routeRateLimit({
  name: 'login',
  ip: {
    windowMs: config.routeRateLimit.login.windowMs,
    max: config.routeRateLimit.login.maxPerIp,
  },
  email: {
    windowMs: config.routeRateLimit.login.windowMs,
    max: config.routeRateLimit.login.maxPerEmail,
  },
});
for (const portal of PORTALS) {
  authRouter.post(`/${portal}/login`, ...loginLimits, portalLogin(portal));
}

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 */
authRouter.post(
  '/refresh',
  ...routeRateLimit({
    name: 'refresh',
    ip: {
      windowMs: config.routeRateLimit.refresh.windowMs,
      max: config.routeRateLimit.refresh.maxPerIp,
    },
  }),
  AuthController.refresh
);

/**
 * @openapi
 * /auth/reauthenticate:
 *   post:
 *     summary: Confirm the current password for sensitive actions
 *     tags: [Auth]
 *     description: Marks the current session as freshly re-authenticated for a configured window (REAUTH_WINDOW_MINUTES). Wrong password returns 401 and counts toward lockout; too many attempts return 429.
 *     responses:
 *       200:
 *         description: Fresh until reauthenticatedUntil
 *       401:
 *         description: Not signed in, or wrong password
 *       429:
 *         description: Too many attempts
 */
authRouter.post(
  '/reauthenticate',
  ...routeRateLimit({
    name: 'reauth',
    ip: {
      windowMs: config.routeRateLimit.reauth.windowMs,
      max: config.routeRateLimit.reauth.maxPerIp,
    },
  }),
  authenticate,
  AuthController.reauthenticate
);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Logout and revoke refresh token
 *     tags: [Auth]
 */
authRouter.post('/logout', AuthController.logout);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
authRouter.get('/me', authenticate, AuthController.me);

/**
 * @openapi
 * /auth/sessions:
 *   get:
 *     summary: List active user sessions
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
authRouter.get('/sessions', authenticate, AuthController.getSessions);

/**
 * @openapi
 * /auth/sessions/{jti}:
 *   delete:
 *     summary: Revoke a specific session
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
authRouter.delete('/sessions/:jti', authenticate, AuthController.revokeSession);

/**
 * @openapi
 * /auth/sessions:
 *   delete:
 *     summary: Revoke all other sessions
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
authRouter.delete('/sessions', authenticate, AuthController.revokeOtherSessions);
