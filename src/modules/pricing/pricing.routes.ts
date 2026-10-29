import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import * as Pricing from './pricing.controller.js';

// ── Resolution and quotes. Public for now; access is decision D4. ─────────────
export const pricesRouter = Router();

/**
 * @openapi
 * /prices/resolve:
 *   get:
 *     summary: Resolve the session price for an offering and optional tutor
 *     description: Tutor rule for the curriculum, otherwise the curriculum's default rule, otherwise PRICE_NOT_CONFIGURED. Never returns 0.
 *     tags: [Pricing]
 *     security: []
 *     parameters:
 *       - { in: query, name: curriculumId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: facultyId, schema: { type: string, format: uuid } }
 *       - { in: query, name: at, schema: { type: string, format: date-time } }
 *     responses:
 *       200: { description: Resolved amounts with matchedRuleId, or available=false with a reason }
 *       404: { description: Unknown curriculum or faculty }
 *       422: { description: Invalid query }
 */
pricesRouter.get('/resolve', Pricing.resolvePrice);

/**
 * @openapi
 * /prices/quote:
 *   post:
 *     summary: Quote prices for several offerings (min and max when the board is omitted)
 *     tags: [Pricing]
 *     security: []
 *     parameters:
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 maxItems: 50
 *                 items:
 *                   type: object
 *                   properties:
 *                     curriculumId: { type: string, format: uuid }
 *                     categoryId: { type: string, format: uuid }
 *                     boardId: { type: string, format: uuid, nullable: true }
 *                     subjectId: { type: string, format: uuid }
 *                     levelId: { type: string, format: uuid }
 *                     facultyId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       200: { description: One result per item, in request order }
 *       403: { description: Missing CSRF token }
 *       422: { description: Invalid items }
 */
pricesRouter.post('/quote', Pricing.quotePrices);

// ── Admin price rules ──────────────────────────────────────────────────────────
export const adminPricesRouter = Router();
adminPricesRouter.use(authenticate);
// Audit: the global audit middleware records each request; the service records the changed values.

const read = requirePermission('pricing.read');
const manage = requirePermission('pricing.manage');

/**
 * @openapi
 * /admin/prices:
 *   get:
 *     summary: List price rules with GST and student totals (screen 29)
 *     tags: [Pricing]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: facultyId, schema: { type: string, format: uuid } }
 *       - { in: query, name: defaultOnly, schema: { type: boolean } }
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - { in: query, name: boardId, schema: { type: string, format: uuid } }
 *       - { in: query, name: subjectId, schema: { type: string, format: uuid } }
 *       - { in: query, name: levelId, schema: { type: string, format: uuid } }
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *       - { in: query, name: q, schema: { type: string, maxLength: 100 } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200: { description: Price rules }
 *       401: { description: Not authenticated }
 *       403: { description: Missing pricing.read }
 *   post:
 *     summary: Create a price rule (facultyId null = default price)
 *     tags: [Pricing]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [curriculumId, facultyId, sessionPricePaise]
 *             properties:
 *               curriculumId: { type: string, format: uuid }
 *               facultyId: { type: string, format: uuid, nullable: true }
 *               sessionPricePaise: { type: integer, minimum: 1, maximum: 100000000 }
 *               effectiveFrom: { type: string, format: date-time }
 *               effectiveTo: { type: string, format: date-time, nullable: true }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201: { description: Created rule with computed GST and student total }
 *       403: { description: Missing pricing.manage or CSRF token }
 *       409: { description: Overlapping active rule }
 *       422: { description: Unknown curriculum or faculty, or invalid amount or window }
 */
adminPricesRouter.get('/', read, Pricing.listPriceRules);
adminPricesRouter.post('/', manage, Pricing.createPriceRule);

/**
 * @openapi
 * /admin/prices/bulk:
 *   put:
 *     summary: Save several price changes atomically (screen 29b)
 *     tags: [Pricing]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [changes]
 *             properties:
 *               changes:
 *                 type: array
 *                 maxItems: 200
 *                 items:
 *                   type: object
 *                   required: [id, sessionPricePaise, expectedRevision]
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     sessionPricePaise: { type: integer, minimum: 1 }
 *                     expectedRevision: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: All changes saved }
 *       403: { description: Missing pricing.manage or CSRF token }
 *       409: { description: Nothing saved; errors lists the rejected rows as changes[i] }
 *       422: { description: Invalid body }
 */
adminPricesRouter.put('/bulk', manage, Pricing.bulkUpdatePriceRules);

/**
 * @openapi
 * /admin/prices/{priceId}:
 *   put:
 *     summary: Update or deactivate a price rule
 *     tags: [Pricing]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: priceId, required: true, schema: { type: string, format: uuid } }
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [expectedRevision]
 *             properties:
 *               sessionPricePaise: { type: integer, minimum: 1, maximum: 100000000 }
 *               effectiveFrom: { type: string, format: date-time }
 *               effectiveTo: { type: string, format: date-time, nullable: true }
 *               isActive: { type: boolean }
 *               expectedRevision: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Updated rule }
 *       403: { description: Missing pricing.manage or CSRF token }
 *       404: { description: Unknown price rule }
 *       409: { description: Stale revision or overlapping active rule }
 *       422: { description: Invalid change }
 */
adminPricesRouter.put('/:priceId', manage, Pricing.updatePriceRule);
