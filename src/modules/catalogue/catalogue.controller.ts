import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { successResponse } from '@core/response/index';
import {
  AdminCurriculumListQueryDto,
  AdminLevelListQueryDto,
  AdminMasterListQueryDto,
  AdminTreeQueryDto,
  CreateNodeDto,
  CreatePathDto,
  CurriculumListQueryDto,
  LevelListQueryDto,
  MasterListQueryDto,
  MoveNodeDto,
  NodeIdParamsDto,
  PublicTreeQueryDto,
  ReorderNodesDto,
  UpdateNodeDto,
} from './catalogue.dto.js';
import * as Lists from './catalogue.lists.service.js';
import * as Mutations from './catalogue.mutations.js';
import { getNodeDetail, getTree, type Actor } from './catalogue.service.js';

// Public catalogue data changes rarely; a short shared cache keeps dropdowns fast
const PUBLIC_CACHE = 'public, max-age=60';

const actorOf = (req: Request): Actor => ({ userId: req.user?.sub ?? null });

function handler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

function publicJson(res: Response, body: unknown): void {
  res.set('Cache-Control', PUBLIC_CACHE).json(body);
}

// ── Master lists ────────────────────────────────────────────────────────────

export const listCategories = handler(async (req, res) => {
  const query = MasterListQueryDto.parse(req.query);
  const result = await Lists.listCategories({ ...query, isActive: true });
  publicJson(res, successResponse(result.items, 'Categories retrieved', result.meta));
});

export const listCategoriesAdmin = handler(async (req, res) => {
  const result = await Lists.listCategories(AdminMasterListQueryDto.parse(req.query));
  res.json(successResponse(result.items, 'Categories retrieved', result.meta));
});

export const listBoards = handler(async (req, res) => {
  const result = await Lists.listBoards({ ...MasterListQueryDto.parse(req.query), isActive: true });
  publicJson(res, successResponse(result.items, 'Boards retrieved', result.meta));
});

export const listBoardsAdmin = handler(async (req, res) => {
  const result = await Lists.listBoards(AdminMasterListQueryDto.parse(req.query));
  res.json(successResponse(result.items, 'Boards retrieved', result.meta));
});

export const listTeachingLanguages = handler(async (req, res) => {
  const result = await Lists.listTeachingLanguages({
    ...MasterListQueryDto.parse(req.query),
    isActive: true,
  });
  publicJson(res, successResponse(result.items, 'Teaching languages retrieved', result.meta));
});

export const listSubjects = handler(async (req, res) => {
  const result = await Lists.listSubjects({
    ...MasterListQueryDto.parse(req.query),
    isActive: true,
  });
  publicJson(res, successResponse(result.items, 'Subjects retrieved', result.meta));
});

export const listSubjectsAdmin = handler(async (req, res) => {
  const result = await Lists.listSubjects(AdminMasterListQueryDto.parse(req.query));
  res.json(successResponse(result.items, 'Subjects retrieved', result.meta));
});

export const listLevels = handler(async (req, res) => {
  const result = await Lists.listLevels({ ...LevelListQueryDto.parse(req.query), isActive: true });
  publicJson(res, successResponse(result.items, 'Levels retrieved', result.meta));
});

export const listLevelsAdmin = handler(async (req, res) => {
  const result = await Lists.listLevels(AdminLevelListQueryDto.parse(req.query));
  res.json(successResponse(result.items, 'Levels retrieved', result.meta));
});

export const listCurricula = handler(async (req, res) => {
  const result = await Lists.listCurricula(CurriculumListQueryDto.parse(req.query), {
    publicOnly: true,
  });
  publicJson(res, successResponse(result.items, 'Curricula retrieved', result.meta));
});

export const listCurriculaAdmin = handler(async (req, res) => {
  const result = await Lists.listCurricula(AdminCurriculumListQueryDto.parse(req.query), {
    publicOnly: false,
  });
  res.json(successResponse(result.items, 'Curricula retrieved', result.meta));
});

// ── Tree ────────────────────────────────────────────────────────────────────

export const getPublicTree = handler(async (req, res) => {
  const { categoryId } = PublicTreeQueryDto.parse(req.query);
  publicJson(
    res,
    successResponse(await getTree(categoryId, { publishedOnly: true }), 'Catalogue tree retrieved')
  );
});

export const getAdminTree = handler(async (req, res) => {
  const { categoryId, q } = AdminTreeQueryDto.parse(req.query);
  res.json(
    successResponse(
      await getTree(categoryId, { publishedOnly: false, q }),
      'Catalogue tree retrieved'
    )
  );
});

export const getPublicNode = handler(async (req, res) => {
  const { nodeId } = NodeIdParamsDto.parse(req.params);
  publicJson(res, successResponse(await getNodeDetail(nodeId, { publicOnly: true })));
});

export const getAdminNode = handler(async (req, res) => {
  const { nodeId } = NodeIdParamsDto.parse(req.params);
  res.json(successResponse(await getNodeDetail(nodeId, { publicOnly: false })));
});

export const createPath = handler(async (req, res) => {
  const result = await Mutations.createPath(CreatePathDto.parse(req.body), actorOf(req));
  res.status(201).json(successResponse(result, 'Catalogue path created'));
});

export const createNode = handler(async (req, res) => {
  const node = await Mutations.createNode(CreateNodeDto.parse(req.body), actorOf(req));
  res.status(201).json(successResponse(node, 'Catalogue node created'));
});

export const updateNode = handler(async (req, res) => {
  const { nodeId } = NodeIdParamsDto.parse(req.params);
  const node = await Mutations.updateNode(nodeId, UpdateNodeDto.parse(req.body), actorOf(req));
  res.json(successResponse(node, 'Catalogue node updated'));
});

export const moveNode = handler(async (req, res) => {
  const { nodeId } = NodeIdParamsDto.parse(req.params);
  const node = await Mutations.moveNode(nodeId, MoveNodeDto.parse(req.body), actorOf(req));
  res.json(successResponse(node, 'Catalogue node moved'));
});

export const archiveNode = handler(async (req, res) => {
  const { nodeId } = NodeIdParamsDto.parse(req.params);
  res.json(
    successResponse(await Mutations.archiveNode(nodeId, actorOf(req)), 'Catalogue node archived')
  );
});

export const reorderNodes = handler(async (req, res) => {
  const result = await Mutations.reorderNodes(ReorderNodesDto.parse(req.body), actorOf(req));
  res.json(successResponse(result, 'Catalogue nodes reordered'));
});
