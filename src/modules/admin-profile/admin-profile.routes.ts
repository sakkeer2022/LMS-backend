import { Router } from 'express';
import { authenticate, requireRole } from '@middleware/authenticate';
import * as AdminProfileController from './admin-profile.controller.js';

export const adminProfileRouter = Router();

// Self only: every handler acts on the authenticated account, never an ID from the request
adminProfileRouter.use(authenticate, requireRole('admin', 'super_admin'));

/**
 * @openapi
 * /admin/me/profile:
 *   put:
 *     summary: Update the signed-in admin's own profile (name, mobile number, time zone)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Profile updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - not an admin
 *       422:
 *         description: Validation failed
 */
adminProfileRouter.put('/profile', AdminProfileController.updateProfile);

/**
 * @openapi
 * /admin/me/activity:
 *   get:
 *     summary: List the signed-in admin's own sign-in and security events
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Activity retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - not an admin
 */
adminProfileRouter.get('/activity', AdminProfileController.listActivity);
