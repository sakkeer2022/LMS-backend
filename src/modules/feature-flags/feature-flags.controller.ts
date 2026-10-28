import { Request, Response, NextFunction } from 'express';
import {
  CreateFeatureFlagDto,
  UpdateFeatureFlagDto,
  PaginationQueryDto,
} from './feature-flags.dto.js';
import * as FeatureFlagsService from './feature-flags.service.js';
import { successResponse } from '@core/response/index';

interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;
    email: string;
    roles: string[];
    permissions: string[];
  };
}

export async function listFeatureFlags(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = PaginationQueryDto.parse(req.query);
    const result = await FeatureFlagsService.listFeatureFlags(query);
    res.json(successResponse(result.items, 'Feature flags retrieved', result.meta));
  } catch (err) {
    next(err);
  }
}

export async function getFeatureFlagById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const flag = await FeatureFlagsService.getFeatureFlagById(req.params['id'] as string);
    res.json(successResponse(flag));
  } catch (err) {
    next(err);
  }
}

export async function createFeatureFlag(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = CreateFeatureFlagDto.parse(req.body);
    const userId = req.user?.sub ?? null;
    const flag = await FeatureFlagsService.createFeatureFlag(dto, userId);
    res.status(201).json(successResponse(flag, 'Feature flag created'));
  } catch (err) {
    next(err);
  }
}

export async function updateFeatureFlag(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = UpdateFeatureFlagDto.parse(req.body);
    const flag = await FeatureFlagsService.updateFeatureFlag(req.params['id'] as string, dto);
    res.json(successResponse(flag, 'Feature flag updated'));
  } catch (err) {
    next(err);
  }
}

export async function deleteFeatureFlag(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await FeatureFlagsService.deleteFeatureFlag(req.params['id'] as string);
    res.json(successResponse(null, 'Feature flag deleted'));
  } catch (err) {
    next(err);
  }
}
