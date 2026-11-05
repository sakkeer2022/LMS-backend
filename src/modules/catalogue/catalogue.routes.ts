import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import * as Catalogue from './catalogue.controller.js';

// ── Public catalogue (no authentication; student registration uses these) ────
export const catalogueRouter = Router();

/**
 * @openapi
 * /catalogue/categories:
 *   get:
 *     summary: List active categories (the four tabs)
 *     tags: [Catalogue]
 *     security: []
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200: { description: Active categories in display order }
 *       422: { description: Invalid query }
 */
catalogueRouter.get('/categories', Catalogue.listCategories);

/**
 * @openapi
 * /catalogue/boards:
 *   get:
 *     summary: List active boards, ordered by sortOrder then name
 *     tags: [Catalogue]
 *     security: []
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200: { description: Active boards }
 *       422: { description: Invalid query }
 */
catalogueRouter.get('/boards', Catalogue.listBoards);

/**
 * @openapi
 * /catalogue/subjects:
 *   get:
 *     summary: List the active master subject list, ordered by sortOrder then name
 *     tags: [Catalogue]
 *     security: []
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200: { description: Active subjects }
 *       422: { description: Invalid query }
 */
catalogueRouter.get('/subjects', Catalogue.listSubjects);

/**
 * @openapi
 * /catalogue/levels:
 *   get:
 *     summary: List active levels, optionally for one category, ordered by sortOrder
 *     tags: [Catalogue]
 *     security: []
 *     parameters:
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200: { description: Active levels }
 *       422: { description: Invalid query }
 */
catalogueRouter.get('/levels', Catalogue.listLevels);

/**
 * @openapi
 * /catalogue/curricula:
 *   get:
 *     summary: List active offerings (curricula) by category, board and level
 *     tags: [Catalogue]
 *     security: []
 *     parameters:
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - { in: query, name: boardId, schema: { type: string, format: uuid } }
 *       - { in: query, name: levelId, schema: { type: string, format: uuid } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200: { description: Active curricula whose leaf and master rows are all active }
 *       422: { description: Invalid query }
 */
catalogueRouter.get('/curricula', Catalogue.listCurricula);

/**
 * @openapi
 * /catalogue/tree:
 *   get:
 *     summary: Published catalogue tree for one category
 *     description: Only nodes that are published and whose every ancestor is published.
 *     tags: [Catalogue]
 *     security: []
 *     parameters:
 *       - { in: query, name: categoryId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Nested tree with child counts }
 *       404: { description: Unknown or inactive category }
 *       422: { description: Invalid query }
 */
catalogueRouter.get('/tree', Catalogue.getPublicTree);

/**
 * @openapi
 * /catalogue/nodes/{nodeId}:
 *   get:
 *     summary: Published catalogue node with its path
 *     tags: [Catalogue]
 *     security: []
 *     parameters:
 *       - { in: path, name: nodeId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Node detail }
 *       404: { description: Unknown, draft or archived node }
 */
catalogueRouter.get('/nodes/:nodeId', Catalogue.getPublicNode);

// ── Admin catalogue ──────────────────────────────────────────────────────────
export const adminCatalogueRouter = Router();
adminCatalogueRouter.use(authenticate);
// Audit: the global audit middleware records each request; the service records the changed values.

const read = requirePermission('catalogue.read');
const manage = requirePermission('catalogue.manage');

/**
 * @openapi
 * /admin/catalogue/categories:
 *   get:
 *     summary: List all categories, including inactive ones
 *     tags: [Catalogue]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200: { description: Categories }
 *       401: { description: Not authenticated }
 *       403: { description: Missing catalogue.read }
 */
adminCatalogueRouter.get('/categories', read, Catalogue.listCategoriesAdmin);

/**
 * @openapi
 * /admin/catalogue/boards:
 *   get:
 *     summary: List all boards, including inactive ones
 *     tags: [Catalogue]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *     responses:
 *       200: { description: Boards }
 *       401: { description: Not authenticated }
 *       403: { description: Missing catalogue.read }
 */
adminCatalogueRouter.get('/boards', read, Catalogue.listBoardsAdmin);

/**
 * @openapi
 * /admin/catalogue/subjects:
 *   get:
 *     summary: List all subjects, including inactive ones
 *     tags: [Catalogue]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *     responses:
 *       200: { description: Subjects }
 *       401: { description: Not authenticated }
 *       403: { description: Missing catalogue.read }
 */
adminCatalogueRouter.get('/subjects', read, Catalogue.listSubjectsAdmin);

/**
 * @openapi
 * /admin/catalogue/levels:
 *   get:
 *     summary: List all levels, including inactive ones
 *     tags: [Catalogue]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *     responses:
 *       200: { description: Levels }
 *       401: { description: Not authenticated }
 *       403: { description: Missing catalogue.read }
 */
adminCatalogueRouter.get('/levels', read, Catalogue.listLevelsAdmin);

/**
 * @openapi
 * /admin/catalogue/curricula:
 *   get:
 *     summary: List all curricula, including inactive ones
 *     tags: [Catalogue]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - { in: query, name: boardId, schema: { type: string, format: uuid } }
 *       - { in: query, name: levelId, schema: { type: string, format: uuid } }
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *     responses:
 *       200: { description: Curricula }
 *       401: { description: Not authenticated }
 *       403: { description: Missing catalogue.read }
 */
adminCatalogueRouter.get('/curricula', read, Catalogue.listCurriculaAdmin);

/**
 * @openapi
 * /admin/catalogue/tree:
 *   get:
 *     summary: Full catalogue tree for one category, including drafts and archived nodes
 *     tags: [Catalogue]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: categoryId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: q, schema: { type: string, maxLength: 100 }, description: Name search; matches keep their path }
 *     responses:
 *       200: { description: Nested tree with child and descendant counts }
 *       401: { description: Not authenticated }
 *       403: { description: Missing catalogue.read }
 *       404: { description: Unknown category }
 */
adminCatalogueRouter.get('/tree', read, Catalogue.getAdminTree);

/**
 * @openapi
 * /admin/catalogue/nodes/reorder:
 *   put:
 *     summary: Set the order of every child of a parent node
 *     tags: [Catalogue]
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
 *               parentId: { type: string, format: uuid }
 *               orderedIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Order saved }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       422: { description: orderedIds does not list every child exactly once }
 */
adminCatalogueRouter.put('/nodes/reorder', manage, Catalogue.reorderNodes);

/**
 * @openapi
 * /admin/catalogue/nodes/{nodeId}:
 *   get:
 *     summary: Node detail for the screen 28 panel
 *     description: Library, tutor, session and price counts are null until their modules exist.
 *     tags: [Catalogue]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: nodeId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Node detail }
 *       403: { description: Missing catalogue.read }
 *       404: { description: Unknown node }
 *   put:
 *     summary: Edit a node's name, slug, order, status or booking flag
 *     tags: [Catalogue]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: nodeId, required: true, schema: { type: string, format: uuid } }
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, maxLength: 200 }
 *               slug: { type: string, pattern: '^[a-z][a-z0-9_-]*$' }
 *               sortOrder: { type: integer, minimum: 0 }
 *               status: { type: string, enum: [DRAFT, PUBLISHED] }
 *               bookingEnabled: { type: boolean }
 *     responses:
 *       200: { description: Updated node }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       404: { description: Unknown node }
 *       409: { description: Duplicate sibling slug }
 *       422: { description: Invalid change }
 */
adminCatalogueRouter.get('/nodes/:nodeId', read, Catalogue.getAdminNode);
adminCatalogueRouter.put('/nodes/:nodeId', manage, Catalogue.updateNode);

/**
 * @openapi
 * /admin/catalogue/paths:
 *   post:
 *     summary: Add a whole path ending in a level (screen 28a)
 *     description: Reuses existing intermediate nodes and creates the missing ones in one transaction. A combination may appear only once in the tree.
 *     tags: [Catalogue]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [categoryId, subjectId, levelId]
 *             properties:
 *               categoryId: { type: string, format: uuid }
 *               subsectionNodeId: { type: string, format: uuid }
 *               boardId: { type: string, format: uuid, description: Required when the category requires a board; otherwise not allowed }
 *               subjectId: { type: string, format: uuid }
 *               levelId: { type: string, format: uuid }
 *               status: { type: string, enum: [DRAFT, PUBLISHED], default: DRAFT }
 *     responses:
 *       201: { description: The new leaf and the ids of every node created }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       404: { description: Unknown category }
 *       409: { description: Path or combination already exists }
 *       422: { description: Invalid or inactive references }
 */
adminCatalogueRouter.post('/paths', manage, Catalogue.createPath);

/**
 * @openapi
 * /admin/catalogue/nodes:
 *   post:
 *     summary: Create one node under a parent
 *     tags: [Catalogue]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [parentId, type]
 *             properties:
 *               parentId: { type: string, format: uuid }
 *               type: { type: string, enum: [SUBSECTION, BOARD, SUBJECT, LEVEL] }
 *               name: { type: string, description: Required for SUBSECTION; defaults to the master name }
 *               slug: { type: string }
 *               boardId: { type: string, format: uuid }
 *               subjectId: { type: string, format: uuid }
 *               levelId: { type: string, format: uuid }
 *               sortOrder: { type: integer, minimum: 0 }
 *               status: { type: string, enum: [DRAFT, PUBLISHED], default: DRAFT }
 *     responses:
 *       201: { description: Created node }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       409: { description: Duplicate sibling or combination }
 *       422: { description: Invalid parent type, archived parent or invalid reference }
 */
adminCatalogueRouter.post('/nodes', manage, Catalogue.createNode);

/**
 * @openapi
 * /admin/catalogue/nodes/{nodeId}/move:
 *   put:
 *     summary: Move a node under another parent in the same category
 *     tags: [Catalogue]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: nodeId, required: true, schema: { type: string, format: uuid } }
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [parentId], properties: { parentId: { type: string, format: uuid } } }
 *     responses:
 *       200: { description: Moved node }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       404: { description: Unknown node }
 *       409: { description: Offerings in use, or duplicate sibling }
 *       422: { description: Cycle, wrong parent type or another category }
 */
adminCatalogueRouter.put('/nodes/:nodeId/move', manage, Catalogue.moveNode);

/**
 * @openapi
 * /admin/catalogue/nodes/{nodeId}/archive:
 *   put:
 *     summary: Archive a node (blocked while it has children that are not archived)
 *     tags: [Catalogue]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: nodeId, required: true, schema: { type: string, format: uuid } }
 *       - { in: header, name: x-csrf-token, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Archived node }
 *       403: { description: Missing catalogue.manage or CSRF token }
 *       404: { description: Unknown node }
 *       409: { description: Node still has children that are not archived }
 *       422: { description: Category tabs cannot be archived }
 */
adminCatalogueRouter.put('/nodes/:nodeId/archive', manage, Catalogue.archiveNode);
