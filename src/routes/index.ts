import { Router } from 'express';
import { successResponse } from '@core/response/index';
import { authRouter } from '@modules/auth/auth.routes';
import { rolesRouter } from '@modules/roles/roles.routes';
import { permissionsRouter } from '@modules/permissions/permissions.routes';
import { usersRouter } from '@modules/users/users.routes';
import { auditRouter } from '@modules/audit/audit.routes';
import { featureFlagsRouter } from '@modules/feature-flags/index.js';
import { notificationsRouter } from '@modules/notifications/notifications.routes.js';
import { adminRouter } from '@modules/admin/admin.routes.js';
import { uploadsRouter } from '@modules/uploads/uploads.routes.js';
import { auditLogMiddleware } from '@middleware/audit.middleware';
import { catalogueRouter, adminCatalogueRouter } from '@modules/catalogue/index.js';
import { pricesRouter, adminPricesRouter } from '@modules/pricing/index.js';
import {
  adminCategoryTreeRouter,
  learnerCategoryTreeRouter,
} from '@modules/category-tree/index.js';

export const router = Router();

// Apply audit logging to all API routes
router.use(auditLogMiddleware);

// ── Feature routers ───────────────────────────────────────────
router.use('/auth', authRouter);
router.use('/roles', rolesRouter);
router.use('/permissions', permissionsRouter);
router.use('/users', usersRouter);
router.use('/audit', auditRouter);
router.use('/feature-flags', featureFlagsRouter);
router.use('/notifications', notificationsRouter);

// ── Catalogue (LMS-54). Mounted before '/admin', whose router authenticates every path ──
// Category tree (ADR-0005) before '/catalogue', whose router has no '/category-tree' paths
router.use('/catalogue/category-tree', learnerCategoryTreeRouter);
router.use('/catalogue', catalogueRouter);
router.use('/admin/category-tree', adminCategoryTreeRouter);
router.use('/admin/catalogue', adminCatalogueRouter);

// ── Pricing (LMS-58). Also mounted before '/admin' ──
router.use('/prices', pricesRouter);
router.use('/admin/prices', adminPricesRouter);

router.use('/admin', adminRouter);
router.use('/uploads', uploadsRouter);

// ── API info ──────────────────────────────────────────────────
router.get('/', (_req, res) => {
  res.json(successResponse({ version: '1.0.0' }, 'Amentorz API is running'));
});
