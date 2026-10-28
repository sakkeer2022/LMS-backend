import { Request, Response, NextFunction } from 'express';
import { CreatePermissionDto, UpdatePermissionDto, PaginationQueryDto } from './permissions.dto.js';
import * as PermissionsService from './permissions.service.js';
import { successResponse } from '@core/response/index';

export async function listPermissions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = PaginationQueryDto.parse(req.query);
    const result = await PermissionsService.listPermissions(query);
    res.json(successResponse(result.items, 'Permissions retrieved', result.meta));
  } catch (err) {
    next(err);
  }
}

export async function getPermissionById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const permission = await PermissionsService.getPermissionById(req.params['id'] as string);
    res.json(successResponse(permission));
  } catch (err) {
    next(err);
  }
}

export async function createPermission(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = CreatePermissionDto.parse(req.body);
    const permission = await PermissionsService.createPermission(dto);
    res.status(201).json(successResponse(permission, 'Permission created'));
  } catch (err) {
    next(err);
  }
}

export async function updatePermission(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = UpdatePermissionDto.parse(req.body);
    const permission = await PermissionsService.updatePermission(req.params['id'] as string, dto);
    res.json(successResponse(permission, 'Permission updated'));
  } catch (err) {
    next(err);
  }
}

export async function deletePermission(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await PermissionsService.deletePermission(req.params['id'] as string);
    res.json(successResponse(null, 'Permission deleted'));
  } catch (err) {
    next(err);
  }
}
