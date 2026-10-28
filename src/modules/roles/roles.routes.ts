import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import * as RolesController from './roles.controller.js';

export const rolesRouter = Router();

// All roles routes require authentication
rolesRouter.use(authenticate);

/**
 * @openapi
 * /roles:
 *   get:
 *     summary: List all roles (paginated)
 *     tags: [Roles]
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
rolesRouter.get('/', requirePermission('role.read'), RolesController.listRoles);

/**
 * @openapi
 * /roles/{id}:
 *   get:
 *     summary: Get role by ID with permissions
 *     tags: [Roles]
 *     security: [{ bearerAuth: [] }]
 */
rolesRouter.get('/:id', requirePermission('role.read'), RolesController.getRoleById);

/**
 * @openapi
 * /roles:
 *   post:
 *     summary: Create a new role
 *     tags: [Roles]
 *     security: [{ bearerAuth: [] }]
 */
rolesRouter.post('/', requirePermission('role.create'), RolesController.createRole);

/**
 * @openapi
 * /roles/{id}:
 *   patch:
 *     summary: Update role name, description, or status
 *     tags: [Roles]
 *     security: [{ bearerAuth: [] }]
 */
rolesRouter.patch('/:id', requirePermission('role.update'), RolesController.updateRole);

/**
 * @openapi
 * /roles/{id}:
 *   delete:
 *     summary: Soft-delete a role (system roles are protected)
 *     tags: [Roles]
 *     security: [{ bearerAuth: [] }]
 */
rolesRouter.delete('/:id', requirePermission('role.delete'), RolesController.deleteRole);

// ── Permission management ────────────────────────────────────────

/**
 * @openapi
 * /roles/{id}/permissions:
 *   post:
 *     summary: Add permissions to a role
 *     tags: [Roles]
 *     security: [{ bearerAuth: [] }]
 */
rolesRouter.post(
  '/:id/permissions',
  requirePermission('role.assign_permission'),
  RolesController.assignPermissions
);

/**
 * @openapi
 * /roles/{id}/permissions:
 *   put:
 *     summary: Replace all permissions on a role
 *     tags: [Roles]
 *     security: [{ bearerAuth: [] }]
 */
rolesRouter.put(
  '/:id/permissions',
  requirePermission('role.assign_permission'),
  RolesController.setPermissions
);

/**
 * @openapi
 * /roles/{id}/permissions:
 *   delete:
 *     summary: Remove specific permissions from a role
 *     tags: [Roles]
 *     security: [{ bearerAuth: [] }]
 */
rolesRouter.delete(
  '/:id/permissions',
  requirePermission('role.assign_permission'),
  RolesController.removePermissions
);
