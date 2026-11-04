import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { successResponse } from '@core/response/index';
import { logger } from '@core/logger/index';
import { isFeatureEnabled } from '@modules/feature-flags/index';
import {
  AddOfferingDto,
  AdminTreeQueryDto,
  CategoryIdParamsDto,
  CreateChildDto,
  CreateRootDto,
  CurriculumIdParamsDto,
  DeleteQueryDto,
  LeafSettingsDto,
  LearnerChildrenQueryDto,
  LearnerLeafQueryDto,
  LearnerLeavesQueryDto,
  MoveDto,
  ReorderDto,
  ResolveOfferingQueryDto,
  UpdateCategoryDto,
  UpdateOfferingDto,
} from './category-tree.dto.js';
import { treeError } from './category-tree.errors.js';
import { getAdminTree, getCategoryDetail, listAdminChildren } from './category-tree.reads.js';
import { getOfferingTree } from './category-tree.picker.js';
import * as Service from './category-tree.service.js';
import * as Structure from './category-tree.structure.js';
import * as Offerings from './category-tree.offerings.js';
import * as Learner from './category-tree.learner.js';

/** Feature flag guarding the learner read path (ADR-0005). Off or missing = 404. */
export const LEARNER_FLAG = 'catalogue.category_tree';

const actorOf = (req: Request): Service.Actor => ({ userId: req.user?.sub ?? null });

function handler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// ── Admin ───────────────────────────────────────────────────────────────────

export const getTree = handler(async (req, res) => {
  const query = AdminTreeQueryDto.parse(req.query);
  if (query.parentId) {
    res.json(successResponse(await listAdminChildren(query.parentId), 'Children retrieved'));
    return;
  }
  const { tree, cached } = await getAdminTree();
  // Private: the tree includes drafts; the client caches it for the session instead
  res.set('Cache-Control', 'private, no-store').set('X-Cache', cached ? 'HIT' : 'MISS');
  res.json(successResponse(tree, 'Category tree retrieved'));
});

export const getRoots = handler(async (_req, res) => {
  res.json(successResponse(await listAdminChildren(null), 'Root categories retrieved'));
});

export const getCategory = handler(async (req, res) => {
  const { categoryId } = CategoryIdParamsDto.parse(req.params);
  res.json(successResponse(await getCategoryDetail(categoryId), 'Category retrieved'));
});

export const createRoot = handler(async (req, res) => {
  const body = CreateRootDto.parse(req.body);
  const { node, created } = await Service.createCategory(null, body, actorOf(req));
  res
    .status(created ? 201 : 200)
    .json(
      successResponse(node, created ? 'Root category created' : 'Root category already exists')
    );
});

export const createChild = handler(async (req, res) => {
  const { categoryId } = CategoryIdParamsDto.parse(req.params);
  const body = CreateChildDto.parse(req.body);
  const { node, created } = await Service.createCategory(categoryId, body, actorOf(req));
  res
    .status(created ? 201 : 200)
    .json(successResponse(node, created ? 'Sub-category created' : 'Sub-category already exists'));
});

export const updateCategory = handler(async (req, res) => {
  const { categoryId } = CategoryIdParamsDto.parse(req.params);
  const body = UpdateCategoryDto.parse(req.body);
  res.json(
    successResponse(
      await Service.updateCategory(categoryId, body, actorOf(req)),
      'Category updated'
    )
  );
});

export const setLeafSettings = handler(async (req, res) => {
  const { categoryId } = CategoryIdParamsDto.parse(req.params);
  const body = LeafSettingsDto.parse(req.body);
  res.json(
    successResponse(
      await Service.setLeafSettings(categoryId, body, actorOf(req)),
      'Booking settings saved'
    )
  );
});

export const reorder = handler(async (req, res) => {
  const body = ReorderDto.parse(req.body);
  res.json(successResponse(await Structure.reorderSiblings(body, actorOf(req)), 'Order saved'));
});

export const move = handler(async (req, res) => {
  const { categoryId } = CategoryIdParamsDto.parse(req.params);
  const body = MoveDto.parse(req.body);
  res.json(
    successResponse(await Structure.moveCategory(categoryId, body, actorOf(req)), 'Category moved')
  );
});

export const remove = handler(async (req, res) => {
  const { categoryId } = CategoryIdParamsDto.parse(req.params);
  const { version } = DeleteQueryDto.parse(req.query);
  await Structure.deleteCategory(categoryId, version, actorOf(req));
  res.status(204).end();
});

export const listOfferings = handler(async (req, res) => {
  const { categoryId } = CategoryIdParamsDto.parse(req.params);
  res.json(successResponse(await Offerings.listOfferings(categoryId), 'Offerings retrieved'));
});

export const addOffering = handler(async (req, res) => {
  const { categoryId } = CategoryIdParamsDto.parse(req.params);
  const body = AddOfferingDto.parse(req.body);
  const { offering, created } = await Offerings.addOffering(categoryId, body, actorOf(req));
  res
    .status(created ? 201 : 200)
    .json(successResponse(offering, created ? 'Offering added' : 'Offering already exists'));
});

export const updateOffering = handler(async (req, res) => {
  const { curriculumId } = CurriculumIdParamsDto.parse(req.params);
  const { isActive } = UpdateOfferingDto.parse(req.body);
  res.json(
    successResponse(
      await Offerings.setOfferingActive(curriculumId, isActive, actorOf(req)),
      'Offering updated'
    )
  );
});

export const getPicker = handler(async (_req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json(successResponse(await getOfferingTree(), 'Offering tree retrieved'));
});

export const getStatus = handler(async (_req, res) => {
  res.json(
    successResponse(
      { learnerCatalogueEnabled: await isFeatureEnabled(LEARNER_FLAG) },
      'Category tree status'
    )
  );
});

// ── Learner (flag-gated) ────────────────────────────────────────────────────

/** 404 while the learner read path is switched off, so it can be turned off without a deploy. */
export const requireLearnerFlag: RequestHandler = (_req, _res, next) => {
  isFeatureEnabled(LEARNER_FLAG)
    .then((on) => {
      if (on) return next();
      logger.debug({ flag: LEARNER_FLAG }, 'Learner category tree is switched off');
      next(treeError('FEATURE_DISABLED'));
    })
    .catch(next);
};

const LEARNER_CACHE = 'public, max-age=60';

export const learnerChildren = handler(async (req, res) => {
  const { parentId } = LearnerChildrenQueryDto.parse(req.query);
  res
    .set('Cache-Control', LEARNER_CACHE)
    .json(successResponse(await Learner.listLearnerChildren(parentId), 'Categories retrieved'));
});

export const learnerLeaves = handler(async (req, res) => {
  const query = LearnerLeavesQueryDto.parse(req.query);
  const result = await Learner.listLearnerLeaves(query);
  res
    .set('Cache-Control', LEARNER_CACHE)
    .json(successResponse(result.items, 'Bookable categories retrieved', result.meta));
});

export const learnerLeaf = handler(async (req, res) => {
  const { categoryId } = CategoryIdParamsDto.parse(req.params);
  const choice = LearnerLeafQueryDto.parse(req.query);
  res
    .set('Cache-Control', LEARNER_CACHE)
    .json(successResponse(await Learner.getLearnerLeaf(categoryId, choice), 'Category retrieved'));
});

export const learnerOffering = handler(async (req, res) => {
  const { categoryId } = CategoryIdParamsDto.parse(req.params);
  const choice = ResolveOfferingQueryDto.parse(req.query);
  res.json(
    successResponse(
      await Offerings.resolveBookableOffering({ categoryId, ...choice }),
      'Offering resolved'
    )
  );
});
