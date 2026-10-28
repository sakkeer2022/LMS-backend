import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import * as FeatureFlagsController from './feature-flags.controller.js';

export const featureFlagsRouter = Router();

// All feature flag routes require authentication
featureFlagsRouter.use(authenticate);

/**
 * @openapi
 * /feature-flags:
 *   get:
 *     summary: List all feature flags (paginated)
 *     tags: [Feature Flags]
 *     security: [{ bearerAuth: [] }]
 */
featureFlagsRouter.get(
  '/',
  requirePermission('feature_flags:read'),
  FeatureFlagsController.listFeatureFlags
);

/**
 * @openapi
 * /feature-flags/{id}:
 *   get:
 *     summary: Get feature flag by ID
 *     tags: [Feature Flags]
 *     security: [{ bearerAuth: [] }]
 */
featureFlagsRouter.get(
  '/:id',
  requirePermission('feature_flags:read'),
  FeatureFlagsController.getFeatureFlagById
);

/**
 * @openapi
 * /feature-flags:
 *   post:
 *     summary: Create a new feature flag
 *     tags: [Feature Flags]
 *     security: [{ bearerAuth: [] }]
 */
featureFlagsRouter.post(
  '/',
  requirePermission('feature_flags:create'),
  FeatureFlagsController.createFeatureFlag
);

/**
 * @openapi
 * /feature-flags/{id}:
 *   patch:
 *     summary: Update feature flag details
 *     tags: [Feature Flags]
 *     security: [{ bearerAuth: [] }]
 */
featureFlagsRouter.patch(
  '/:id',
  requirePermission('feature_flags:update'),
  FeatureFlagsController.updateFeatureFlag
);

/**
 * @openapi
 * /feature-flags/{id}:
 *   delete:
 *     summary: Delete a feature flag
 *     tags: [Feature Flags]
 *     security: [{ bearerAuth: [] }]
 */
featureFlagsRouter.delete(
  '/:id',
  requirePermission('feature_flags:delete'),
  FeatureFlagsController.deleteFeatureFlag
);
