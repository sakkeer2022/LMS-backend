import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import * as AuditController from './audit.controller.js';

export const auditRouter = Router();

// All audit routes require authentication and audit.read privileges
auditRouter.use(authenticate);
auditRouter.use(requirePermission('audit.read'));

/**
 * @openapi
 * /audit:
 *   get:
 *     summary: List audit logs (paginated)
 *     tags: [Audit]
 *     security: [{ bearerAuth: [] }]
 */
auditRouter.get('/', AuditController.listAuditLogs);
