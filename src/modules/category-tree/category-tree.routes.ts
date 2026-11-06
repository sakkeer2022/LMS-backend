import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import * as Tree from './category-tree.controller.js';

// Every error response carries a `code` (for example STALE_VERSION, DELETE_BLOCKED,
// PARENT_IS_BOOKABLE) and a message written for the user. See category-tree.errors.ts.

// ── Admin: /admin/category-tree ──────────────────────────────────────────────
export const adminCategoryTreeRouter = Router();
adminCategoryTreeRouter.use(authenticate);
const read = requirePermission('catalogue.read');
const manage = requirePermission('catalogue.manage');

/**
 * @openapi
 * /admin/category-tree:
 *   get:
 *     summary: The whole category tree with child and curricula counts (one aggregate query, cached until the next write)
 *     description: With parentId, returns only that node's direct children, for lazy loading a large tree.
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: parentId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ nodes, stats, generatedAt } or, with parentId, an array of nodes. Header X-Cache is HIT or MISS." }
 *       401: { description: Not authenticated }
 *       403: { description: Missing catalogue.read }
 *       404: { description: CATEGORY_NOT_FOUND (unknown parentId) }
 */
adminCategoryTreeRouter.get('/', read, Tree.getTree);

/**
 * @openapi
 * /admin/category-tree/status:
 *   get:
 *     summary: Whether the learner catalogue (feature flag catalogue.category_tree) is switched on
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ learnerCatalogueEnabled: boolean }" }
 *       401: { description: Not authenticated }
 *       403: { description: Missing catalogue.read }
 */
adminCategoryTreeRouter.get('/status', read, Tree.getStatus);

/**
 * @openapi
 * /admin/category-tree/roots:
 *   post:
 *     summary: Create a root category (no parent)
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code: { type: string, maxLength: 50, pattern: "^[a-z][a-z0-9_-]*$" }
 *               name: { type: string, maxLength: 100 }
 *     responses:
 *       201: { description: Created }
 *       200: { description: Idempotent retry; an identical root already exists }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       409: { description: DUPLICATE_CODE }
 *       422: { description: Invalid body }
 */
adminCategoryTreeRouter.post('/roots', manage, Tree.createRoot);

/**
 * @openapi
 * /admin/category-tree/reorder:
 *   put:
 *     summary: Reorder the children of one parent (null = the roots). Does not change any parent.
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [parentId, orderedIds]
 *             properties:
 *               parentId: { type: string, format: uuid, nullable: true }
 *               orderedIds: { type: array, items: { type: string, format: uuid }, description: Every child exactly once }
 *     responses:
 *       200: { description: The children in their new order }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       409: { description: STALE_SIBLINGS (the list of children changed) }
 *       422: { description: PARENT_NOT_FOUND or invalid body }
 */
adminCategoryTreeRouter.put('/reorder', manage, Tree.reorder);

/**
 * @openapi
 * /admin/category-tree/offerings/{curriculumId}:
 *   patch:
 *     summary: Activate or deactivate one offering (curriculum)
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: curriculumId, required: true, schema: { type: string, format: uuid } }
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [isActive], properties: { isActive: { type: boolean } } } } }
 *     responses:
 *       200: { description: Updated offering }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       404: { description: NO_OFFERING }
 */
adminCategoryTreeRouter.patch('/offerings/:curriculumId', manage, Tree.updateOffering);

/**
 * @openapi
 * /admin/category-tree/{categoryId}:
 *   get:
 *     summary: Category detail (breadcrumb from the path, allowed levels, counts)
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: categoryId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Category detail }
 *       401: { description: Not authenticated }
 *       403: { description: Missing catalogue.read }
 *       404: { description: CATEGORY_NOT_FOUND }
 *   patch:
 *     summary: Rename, change the code (rebuilds the subtree's paths) or activate/deactivate (hides the subtree from learners)
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: categoryId, required: true, schema: { type: string, format: uuid } }
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [version]
 *             properties:
 *               version: { type: integer, minimum: 1, description: The version the change is based on }
 *               name: { type: string, maxLength: 100 }
 *               code: { type: string, maxLength: 50 }
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: Updated category (also returned for a retry whose values are already saved) }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       404: { description: CATEGORY_NOT_FOUND }
 *       409: { description: STALE_VERSION or DUPLICATE_CODE }
 *   delete:
 *     summary: Hard-delete a category with no children and no references
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: categoryId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: version, required: true, schema: { type: integer, minimum: 1 } }
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       404: { description: CATEGORY_NOT_FOUND }
 *       409: { description: DELETE_BLOCKED (message lists the reasons) or STALE_VERSION }
 */
adminCategoryTreeRouter.get('/:categoryId', read, Tree.getCategory);
adminCategoryTreeRouter.patch('/:categoryId', manage, Tree.updateCategory);
adminCategoryTreeRouter.delete('/:categoryId', manage, Tree.remove);

/**
 * @openapi
 * /admin/category-tree/{categoryId}/children:
 *   post:
 *     summary: Create a sub-category under a parent
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: categoryId, required: true, schema: { type: string, format: uuid } }
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [code, name], properties: { code: { type: string }, name: { type: string } } }
 *     responses:
 *       201: { description: Created }
 *       200: { description: Idempotent retry; an identical sub-category already exists }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       409: { description: PARENT_IS_BOOKABLE or DUPLICATE_CODE }
 *       422: { description: PARENT_NOT_FOUND, PATH_TOO_LONG, TOO_DEEP or invalid body }
 */
adminCategoryTreeRouter.post('/:categoryId/children', manage, Tree.createChild);

/**
 * @openapi
 * /admin/category-tree/{categoryId}/leaf-settings:
 *   put:
 *     summary: Set booking settings of a category without children (bookable, requires board/level, allowed levels)
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: categoryId, required: true, schema: { type: string, format: uuid } }
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [version, isBookable, requiresBoard, requiresLevel, levelIds]
 *             properties:
 *               version: { type: integer, minimum: 1 }
 *               isBookable: { type: boolean }
 *               requiresBoard: { type: boolean }
 *               requiresLevel: { type: boolean }
 *               levelIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Saved }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       409: { description: HAS_CHILDREN, CATEGORY_REFERENCED, LEVEL_IN_USE, LEVEL_REQUIRED_BY_CURRICULA, BOARD_REQUIRED_BY_CURRICULA or STALE_VERSION }
 *       422: { description: LEVELS_REQUIRED, UNKNOWN_LEVEL or INACTIVE_LEVEL }
 */
adminCategoryTreeRouter.put('/:categoryId/leaf-settings', manage, Tree.setLeafSettings);

/**
 * @openapi
 * /admin/category-tree/{categoryId}/move:
 *   put:
 *     summary: Move a category under a new parent (null = make it a root), rebuilding the subtree's paths in one transaction
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: categoryId, required: true, schema: { type: string, format: uuid } }
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [version, parentId]
 *             properties:
 *               version: { type: integer, minimum: 1 }
 *               parentId: { type: string, format: uuid, nullable: true }
 *               index: { type: integer, minimum: 0, description: "Position among the new siblings (0 = first); omitted = last" }
 *     responses:
 *       200: { description: Moved (or already under that parent) }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       409: { description: PARENT_IS_BOOKABLE, DUPLICATE_CODE, STALE_VERSION or CONCURRENT_CHANGE }
 *       422: { description: CYCLE, PARENT_NOT_FOUND, PATH_TOO_LONG or TOO_DEEP }
 */
adminCategoryTreeRouter.put('/:categoryId/move', manage, Tree.move);

/**
 * @openapi
 * /admin/category-tree/{categoryId}/offerings:
 *   get:
 *     summary: Offerings (curricula) of a leaf
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: categoryId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Offerings with subject, board and level names }
 *       403: { description: Missing catalogue.read }
 *       404: { description: CATEGORY_NOT_FOUND }
 *   post:
 *     summary: Add an offering (subject, optional board and level) to a bookable leaf
 *     tags: [Category tree]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: categoryId, required: true, schema: { type: string, format: uuid } }
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subjectId]
 *             properties:
 *               subjectId: { type: string, format: uuid }
 *               boardId: { type: string, format: uuid, nullable: true }
 *               levelId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       201: { description: Added }
 *       200: { description: Idempotent retry; the offering already exists }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       422: { description: NOT_BOOKABLE, BOARD_REQUIRED, LEVEL_REQUIRED, LEVEL_NOT_ALLOWED, UNKNOWN_SUBJECT or UNKNOWN_BOARD }
 */
adminCategoryTreeRouter.get('/:categoryId/offerings', read, Tree.listOfferings);
adminCategoryTreeRouter.post('/:categoryId/offerings', manage, Tree.addOffering);

// ── Learner: /catalogue/category-tree (public, behind the catalogue.category_tree flag) ──
export const learnerCategoryTreeRouter = Router();
learnerCategoryTreeRouter.use(Tree.requireLearnerFlag);

/**
 * @openapi
 * /catalogue/category-tree/children:
 *   get:
 *     summary: Visible children of a category (or the roots) that lead to something bookable
 *     tags: [Category tree]
 *     security: []
 *     parameters:
 *       - { in: query, name: parentId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Children with isLeaf. Cache-Control: public, max-age=60" }
 *       404: { description: CATEGORY_NOT_FOUND (hidden or unknown parent) or FEATURE_DISABLED }
 */
learnerCategoryTreeRouter.get('/children', Tree.learnerChildren);

/**
 * @openapi
 * /catalogue/category-tree/leaves:
 *   get:
 *     summary: Paginated active bookable leaves, optionally under one branch and filtered by name
 *     tags: [Category tree]
 *     security: []
 *     parameters:
 *       - { in: query, name: under, schema: { type: string, format: uuid } }
 *       - { in: query, name: q, schema: { type: string, maxLength: 100 } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200: { description: Leaves with breadcrumb and requires flags }
 *       404: { description: FEATURE_DISABLED or unknown branch }
 */
learnerCategoryTreeRouter.get('/leaves', Tree.learnerLeaves);

/**
 * @openapi
 * /catalogue/category-tree/leaves/{categoryId}:
 *   get:
 *     summary: A bookable leaf with its board, level and subject options
 *     description: boards is filled only when requiresBoard, levels only when requiresLevel. subjects narrow to the chosen board and level.
 *     tags: [Category tree]
 *     security: []
 *     parameters:
 *       - { in: path, name: categoryId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: boardId, schema: { type: string, format: uuid } }
 *       - { in: query, name: levelId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Leaf detail with options }
 *       404: { description: CATEGORY_NOT_FOUND (hidden, inactive or not bookable) or FEATURE_DISABLED }
 */
learnerCategoryTreeRouter.get('/leaves/:categoryId', Tree.learnerLeaf);

/**
 * @openapi
 * /catalogue/category-tree/leaves/{categoryId}/offering:
 *   get:
 *     summary: Resolve a learner's choice on a leaf to the bookable curriculum
 *     tags: [Category tree]
 *     security: []
 *     parameters:
 *       - { in: path, name: categoryId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: subjectId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: boardId, schema: { type: string, format: uuid } }
 *       - { in: query, name: levelId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ curriculumId, categoryId, categoryPath, subjectId, boardId, levelId }" }
 *       404: { description: CATEGORY_NOT_FOUND, NO_OFFERING or FEATURE_DISABLED }
 *       422: { description: NOT_BOOKABLE, BOARD_REQUIRED, LEVEL_REQUIRED or LEVEL_NOT_ALLOWED }
 */
learnerCategoryTreeRouter.get('/leaves/:categoryId/offering', Tree.learnerOffering);
