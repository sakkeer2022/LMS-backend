import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import * as AdminController from './admin.controller.js';

export const adminRouter = Router();

// All admin routes require authentication
adminRouter.use(authenticate);

/**
 * @openapi
 * /admin/stats:
 *   get:
 *     summary: Get dashboard statistics for the admin portal
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Administrative statistics successfully retrieved
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       403:
 *         description: Forbidden - Insufficient permissions (requires admin.read)
 */
adminRouter.get('/stats', requirePermission('admin.read'), AdminController.getStats);

/**
 * @openapi
 * /admin/health:
 *   get:
 *     summary: Get system health check report
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: System health status successfully retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Insufficient permissions (requires admin.read)
 */
adminRouter.get('/health', requirePermission('admin.read'), AdminController.getHealth);

/**
 * @openapi
 * /admin/users/{id}/unlock:
 *   post:
 *     summary: Unlock a locked-out user account
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the user to unlock
 *     responses:
 *       200:
 *         description: User account successfully unlocked
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (requires admin.write)
 *       404:
 *         description: User not found
 */
adminRouter.post('/users/:id/unlock', requirePermission('admin.write'), AdminController.unlockUser);

/**
 * @openapi
 * /admin/users/{id}/active:
 *   put:
 *     summary: Toggle active/inactive status of a user
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the user to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isActive
 *             properties:
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: User active status successfully updated
 *       400:
 *         description: Invalid input parameters or payload
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (requires admin.write)
 *       404:
 *         description: User not found
 */
adminRouter.put(
  '/users/:id/active',
  requirePermission('admin.write'),
  AdminController.setUserActiveState
);
