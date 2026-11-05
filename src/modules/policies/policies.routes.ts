import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import { requireRecentReauth } from '@middleware/require-reauth';
import { validateRequest } from '@middleware/validate';
import * as PoliciesController from './policies.controller.js';
import {
  AdminPoliciesQueryDto,
  CurrentPoliciesQueryDto,
  PolicyParamsDto,
  UploadPolicyDto,
} from './policies.dto.js';
import { policyUpload } from './policies.upload.js';

export const policiesRouter = Router();
/** The admin's Legal documents: every version, coverage per country, upload and rollback. */
export const adminPoliciesRouter = Router();

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

adminPoliciesRouter.use(authenticate);

/**
 * @openapi
 * /admin/policies:
 *   get:
 *     summary: List every policy version
 *     description: All uploaded versions, newest first, current and past. Requires policy.read.
 *     tags: [Consent]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: country, schema: { type: string, minLength: 2, maxLength: 2 } }
 *       - { in: query, name: type, schema: { type: string, enum: [terms_of_use, privacy_policy, child_safety_policy, student_terms] } }
 *     responses:
 *       200:
 *         description: The versions
 *       403:
 *         description: Requires policy.read
 *   post:
 *     summary: Upload a policy version
 *     description: Multipart form with the PDF in `file`. Makes it current for its type and country; the old version stays on record. Requires policy.create and recent reauthentication. Audited.
 *     tags: [Consent]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema: { type: object, required: [type, country, version, title, effectiveAt, file], properties: { type: { type: string }, country: { type: string }, version: { type: string }, title: { type: string }, effectiveAt: { type: string }, file: { type: string, format: binary } } }
 *     responses:
 *       201:
 *         description: The new current version
 *       403:
 *         description: Requires policy.create or recent reauthentication
 *       409:
 *         description: That version already exists
 *       413:
 *         description: The file is too large
 *       422:
 *         description: Not a readable PDF, an unsupported country, or a malformed field
 */
adminPoliciesRouter.get(
  '/',
  requirePermission('policy.read'),
  validateRequest({ query: AdminPoliciesQueryDto }),
  PoliciesController.listAll
);
adminPoliciesRouter.post(
  '/',
  requirePermission('policy.create'),
  requireRecentReauth,
  policyUpload,
  validateRequest({ body: UploadPolicyDto }),
  PoliciesController.upload
);

/**
 * @openapi
 * /admin/policies/coverage:
 *   get:
 *     summary: Which countries lack current policies
 *     description: For each active country, the policy types with no current version. Requires policy.read.
 *     tags: [Consent]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Coverage per country
 *       403:
 *         description: Requires policy.read
 */
adminPoliciesRouter.get('/coverage', requirePermission('policy.read'), PoliciesController.coverage);

/**
 * @openapi
 * /admin/policies/{policyId}/current:
 *   put:
 *     summary: Make an earlier policy version current again
 *     description: Switches which version is current for its type and country. Requires policy.update and recent reauthentication. Audited.
 *     tags: [Consent]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: policyId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: The version that is now current
 *       403:
 *         description: Requires policy.update or recent reauthentication
 *       404:
 *         description: Unknown policy
 */
adminPoliciesRouter.put(
  '/:policyId/current',
  requirePermission('policy.update'),
  requireRecentReauth,
  validateRequest({ params: PolicyParamsDto }),
  PoliciesController.setCurrent
);
