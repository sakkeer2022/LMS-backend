import { Request, Response, NextFunction } from 'express';
import {
  CreateRoleDto,
  UpdateRoleDto,
  AssignPermissionsDto,
  PaginationQueryDto,
} from './roles.dto.js';
import * as RolesService from './roles.service.js';
import { actorFrom } from './system-role-guard.js';
import { successResponse } from '@core/response/index';

export async function listRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = PaginationQueryDto.parse(req.query);
    const result = await RolesService.listRoles(query);
    res.json(successResponse(result.items, 'Roles retrieved', result.meta));
  } catch (err) {
    next(err);
  }
}

export async function getRoleById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const role = await RolesService.getRoleById(req.params['id'] as string);
    res.json(successResponse(role));
  } catch (err) {
    next(err);
  }
}

export async function createRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = CreateRoleDto.parse(req.body);
    const role = await RolesService.createRole(dto, actorFrom(req));
    res.status(201).json(successResponse(role, 'Role created'));
  } catch (err) {
    next(err);
  }
}

export async function updateRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = UpdateRoleDto.parse(req.body);
    const role = await RolesService.updateRole(req.params['id'] as string, dto, actorFrom(req));
    res.json(successResponse(role, 'Role updated'));
  } catch (err) {
    next(err);
  }
}

export async function deleteRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await RolesService.deleteRole(req.params['id'] as string);
    res.json(successResponse(null, 'Role deleted'));
  } catch (err) {
    next(err);
  }
}

export async function assignPermissions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = AssignPermissionsDto.parse(req.body);
    const role = await RolesService.assignPermissions(
      req.params['id'] as string,
      dto,
      actorFrom(req)
    );
    res.json(successResponse(role, 'Permissions assigned'));
  } catch (err) {
    next(err);
  }
}

export async function removePermissions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = AssignPermissionsDto.parse(req.body);
    const role = await RolesService.removePermissions(
      req.params['id'] as string,
      dto,
      actorFrom(req)
    );
    res.json(successResponse(role, 'Permissions removed'));
  } catch (err) {
    next(err);
  }
}

export async function setPermissions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = AssignPermissionsDto.parse(req.body);
    const role = await RolesService.setPermissions(req.params['id'] as string, dto, actorFrom(req));
    res.json(successResponse(role, 'Permissions updated'));
  } catch (err) {
    next(err);
  }
}
