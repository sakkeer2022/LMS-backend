import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import * as PermissionsController from './permissions.controller.js';

export const permissionsRouter = Router();

// All permission routes require authentication
permissionsRouter.use(authenticate);

/**
 * @openapi
 * /permissions:
 *   get:
 *     summary: List all permissions (paginated)
 *     tags: [Permissions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 */
permissionsRouter.get(
  '/',
  requirePermission('permission.read'),
  PermissionsController.listPermissions
);

/**
 * @openapi
 * /permissions/{id}:
 *   get:
 *     summary: Get permission by ID
 *     tags: [Permissions]
 *     security: [{ bearerAuth: [] }]
 */
permissionsRouter.get(
  '/:id',
  requirePermission('permission.read'),
  PermissionsController.getPermissionById
);

/**
 * @openapi
 * /permissions:
 *   post:
 *     summary: Create a new custom permission
 *     tags: [Permissions]
 *     security: [{ bearerAuth: [] }]
 */
permissionsRouter.post(
  '/',
  requirePermission('permission.create'),
  PermissionsController.createPermission
);

/**
 * @openapi
 * /permissions/{id}:
 *   patch:
 *     summary: Update a permission's description
 *     tags: [Permissions]
 *     security: [{ bearerAuth: [] }]
 */
permissionsRouter.patch(
  '/:id',
  requirePermission('permission.update'),
  PermissionsController.updatePermission
);

/**
 * @openapi
 * /permissions/{id}:
 *   delete:
 *     summary: Delete a permission
 *     tags: [Permissions]
 *     security: [{ bearerAuth: [] }]
 */
permissionsRouter.delete(
  '/:id',
  requirePermission('permission.delete'),
  PermissionsController.deletePermission
);
