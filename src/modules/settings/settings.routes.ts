import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import { validateRequest } from '@middleware/validate';
import { requireRecentReauth } from '@middleware/require-reauth';
import * as SettingsController from './settings.controller.js';
import { ListSettingsQueryDto, SettingKeyParamsDto, UpdateSettingDto } from './settings.dto.js';

export const settingsRouter = Router();

settingsRouter.use(authenticate);

/**
 * @openapi
 * /admin/settings:
 *   get:
 *     summary: List platform settings
 *     description: Only server-registered settings are listed, ordered by key. Requires configuration.read.
 *     tags: [Settings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200:
 *         description: Settings with their definition, current value and revision
 *       401:
 *         description: Missing or invalid token
 *       403:
 *         description: Requires configuration.read
 *       422:
 *         description: Invalid page or limit
 */
settingsRouter.get(
  '/',
  requirePermission('configuration.read'),
  validateRequest({ query: ListSettingsQueryDto }),
  SettingsController.listSettings
);

/**
 * @openapi
 * /admin/settings/{key}:
 *   get:
 *     summary: Get one platform setting
 *     tags: [Settings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: key, required: true, schema: { type: string, pattern: '^[a-z][a-zA-Z0-9.]*$' } }
 *     responses:
 *       200:
 *         description: The setting with its definition, current value and revision
 *       401:
 *         description: Missing or invalid token
 *       403:
 *         description: Requires configuration.read
 *       404:
 *         description: Unknown setting key
 *       422:
 *         description: Malformed key
 */
settingsRouter.get(
  '/:key',
  requirePermission('configuration.read'),
  validateRequest({ params: SettingKeyParamsDto }),
  SettingsController.getSetting
);

/**
 * @openapi
 * /admin/settings/{key}:
 *   put:
 *     summary: Change a platform setting
 *     description: >
 *       Applies immediately, without a restart. The value must match the setting's type, bounds
 *       and allowed values. Send the revision you last read as expectedRevision; a stale revision
 *       returns 409. The change, reason and actor are audited. Requires configuration.manage and
 *       CSRF. Recent re-authentication (contract requirement) is added with LMS-100.
 *     tags: [Settings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: key, required: true, schema: { type: string, pattern: '^[a-z][a-zA-Z0-9.]*$' } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [value, expectedRevision, reason]
 *             properties:
 *               value: { oneOf: [{ type: number }, { type: boolean }, { type: string }] }
 *               expectedRevision: { type: integer, minimum: 1 }
 *               reason: { type: string, minLength: 1, maxLength: 1000 }
 *     responses:
 *       200:
 *         description: The updated setting with its new revision
 *       401:
 *         description: Missing or invalid token
 *       403:
 *         description: Requires configuration.manage, recent re-authentication, or CSRF token missing
 *       404:
 *         description: Unknown setting key
 *       409:
 *         description: Stale expectedRevision
 *       422:
 *         description: Wrong type, out of bounds, not an allowed value, or unknown fields
 */
settingsRouter.put(
  '/:key',
  requirePermission('configuration.manage'),
  requireRecentReauth,
  validateRequest({ params: SettingKeyParamsDto, body: UpdateSettingDto }),
  SettingsController.updateSetting
);
