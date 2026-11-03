import { Router } from 'express';
import { validateRequest } from '@middleware/validate';
import * as PoliciesController from './policies.controller.js';
import { CurrentPoliciesQueryDto, PolicyParamsDto } from './policies.dto.js';

export const policiesRouter = Router();

/**
 * @openapi
 * /policies/current:
 *   get:
 *     summary: List the current legal policy versions for a country
 *     description: Terms of Use, Privacy Policy, Child Safety Policy and Student Terms, one current version each, for the country given. The client derives the country from the dialling code of the mobile number. A country never receives another country's texts, so one without all four loaded returns 503, and an unsupported country returns 422.
 *     tags: [Consent]
 *     parameters:
 *       - { in: query, name: country, required: true, schema: { type: string, minLength: 2, maxLength: 2 } }
 *     responses:
 *       200:
 *         description: The four current policies
 *       422:
 *         description: Missing, malformed or unsupported country
 *       503:
 *         description: The policies for this country are not loaded yet
 */
policiesRouter.get(
  '/current',
  validateRequest({ query: CurrentPoliciesQueryDto }),
  PoliciesController.listCurrent
);

/**
 * @openapi
 * /policies/{policyId}/file:
 *   get:
 *     summary: Download a policy PDF
 *     description: The blank PDF for the signing preview and "View full document". Inline, cacheable by version.
 *     tags: [Consent]
 *     parameters:
 *       - { in: path, name: policyId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: The PDF bytes
 *       404:
 *         description: Unknown policy
 *       503:
 *         description: The file is not available in storage
 */
policiesRouter.get(
  '/:policyId/file',
  validateRequest({ params: PolicyParamsDto }),
  PoliciesController.getFile
);
