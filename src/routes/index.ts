import { Router } from 'express';
import { successResponse } from '@core/response/index';
import { authRouter } from '@modules/auth/index';
import { rolesRouter } from '@modules/roles/roles.routes';
import { permissionsRouter } from '@modules/permissions/permissions.routes';
import { usersRouter } from '@modules/users/users.routes';
import { auditRouter } from '@modules/audit/audit.routes';
import { featureFlagsRouter } from '@modules/feature-flags/feature-flags.routes.js';
import { notificationsRouter } from '@modules/notifications/notifications.routes.js';
import { adminProfileRouter } from '@modules/admin-profile/index.js';
import { adminRouter } from '@modules/admin/admin.routes.js';
import { uploadsRouter } from '@modules/uploads/uploads.routes.js';
import { settingsRouter } from '@modules/settings/index.js';
import { registrationRouter } from '@modules/registration/index.js';
import { policiesRouter } from '@modules/policies/index.js';
import { adminConsentRouter, consentRouter, studentConsentRouter } from '@modules/consent/index.js';
import { regionsRouter } from '@modules/regions/index.js';
import { passwordRouter, recoveryRouter } from '@modules/account-recovery/index.js';
import { auditLogMiddleware } from '@middleware/audit.middleware';

export const router = Router();

// Apply audit logging to all API routes
router.use(auditLogMiddleware);

// ── Feature routers ───────────────────────────────────────────
// Mount path of every feature router, in mount order (a more specific path must
// come before a shorter prefix). tests/unit/api-contract-routes.test.ts reads
// this list to check every implemented route against docs/openapi.yaml.
export const featureRouters: ReadonlyArray<readonly [path: string, router: Router]> = [
  ['/auth/registration', registrationRouter],
  ['/regions', regionsRouter],
  ['/policies', policiesRouter],
  ['/consent', consentRouter],
  ['/students/me', studentConsentRouter],
  ['/admin/students', adminConsentRouter],
  ['/auth/recovery', recoveryRouter],
  ['/auth/password', passwordRouter],
  ['/auth', authRouter],
  ['/roles', rolesRouter],
  ['/permissions', permissionsRouter],
  ['/users', usersRouter],
  ['/audit', auditRouter],
  ['/feature-flags', featureFlagsRouter],
  ['/notifications', notificationsRouter],
  ['/admin/settings', settingsRouter],
  ['/admin/me', adminProfileRouter],
  ['/admin', adminRouter],
  ['/uploads', uploadsRouter],
];

for (const [path, featureRouter] of featureRouters) {
  router.use(path, featureRouter);
}

// ── API info ──────────────────────────────────────────────────
router.get('/', (_req, res) => {
  res.json(successResponse({ version: '1.0.0' }, 'Amentorz API is running'));
});
