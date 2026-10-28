import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import * as UsersController from './users.controller.js';

export const usersRouter = Router();

// All user routes require authentication
usersRouter.use(authenticate);

/**
 * @openapi
 * /users:
 *   get:
 *     summary: List all users (paginated)
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 */
usersRouter.get('/', requirePermission('user.read'), UsersController.listUsers);

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     summary: Get user by ID with roles
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 */
usersRouter.get('/:id', requirePermission('user.read'), UsersController.getUserById);

/**
 * @openapi
 * /users:
 *   post:
 *     summary: Create a new user (admin only)
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 */
usersRouter.post('/', requirePermission('user.create'), UsersController.createUser);

/**
 * @openapi
 * /users/{id}:
 *   patch:
 *     summary: Update user profile
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 */
usersRouter.patch('/:id', requirePermission('user.update'), UsersController.updateUser);

/**
 * @openapi
 * /users/{id}:
 *   delete:
 *     summary: Soft-delete a user
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 */
usersRouter.delete('/:id', requirePermission('user.delete'), UsersController.deleteUser);

// ── Role management ────────────────────────────────────────

/**
 * @openapi
 * /users/{id}/roles:
 *   post:
 *     summary: Assign roles to a user
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 */
usersRouter.post('/:id/roles', requirePermission('user.assign_role'), UsersController.assignRoles);

/**
 * @openapi
 * /users/{id}/roles:
 *   put:
 *     summary: Replace all roles on a user
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 */
usersRouter.put('/:id/roles', requirePermission('user.assign_role'), UsersController.setRoles);

/**
 * @openapi
 * /users/{id}/roles:
 *   delete:
 *     summary: Remove specific roles from a user
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 */
usersRouter.delete(
  '/:id/roles',
  requirePermission('user.assign_role'),
  UsersController.removeRoles
);
