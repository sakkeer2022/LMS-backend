import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import * as AuthController from './auth.controller.js';

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
 * /auth/login:
 *   post:
 *     summary: Login with email and password
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
 *       200:
 *         description: Successfully logged in
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
 *                         accessToken:
 *                           type: string
 *                         refreshToken:
 *                           type: string
 *       401:
 *         description: Unauthorized (Invalid credentials)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
authRouter.post('/login', AuthController.login);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 */
authRouter.post('/refresh', AuthController.refresh);

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
