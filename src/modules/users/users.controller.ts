import { Request, Response, NextFunction } from 'express';
import { CreateUserDto, UpdateUserDto, AssignRolesDto, PaginationQueryDto } from './users.dto.js';
import * as UsersService from './users.service.js';
import { successResponse } from '@core/response/index';
import { auditContextFrom } from '@middleware/audit.middleware';

export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = PaginationQueryDto.parse(req.query);
    const result = await UsersService.listUsers(query);
    res.json(successResponse(result.items, 'Users retrieved', result.meta));
  } catch (err) {
    next(err);
  }
}

export async function getUserById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await UsersService.getUserById(req.params['id'] as string);
    res.json(successResponse(user));
  } catch (err) {
    next(err);
  }
}

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = CreateUserDto.parse(req.body);
    const user = await UsersService.createUser(dto);
    res.status(201).json(successResponse(user, 'User created'));
  } catch (err) {
    next(err);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = UpdateUserDto.parse(req.body);
    const user = await UsersService.updateUser(req.params['id'] as string, dto);
    res.json(successResponse(user, 'User updated'));
  } catch (err) {
    next(err);
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await UsersService.deleteUser(req.params['id'] as string);
    res.json(successResponse(null, 'User deleted'));
  } catch (err) {
    next(err);
  }
}

export async function assignRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = AssignRolesDto.parse(req.body);
    const user = await UsersService.assignRoles(
      req.params['id'] as string,
      dto,
      auditContextFrom(req)
    );
    res.json(successResponse(user, 'Roles assigned'));
  } catch (err) {
    next(err);
  }
}

export async function removeRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = AssignRolesDto.parse(req.body);
    const user = await UsersService.removeRoles(
      req.params['id'] as string,
      dto,
      auditContextFrom(req)
    );
    res.json(successResponse(user, 'Roles removed'));
  } catch (err) {
    next(err);
  }
}

export async function setRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = AssignRolesDto.parse(req.body);
    const user = await UsersService.setRoles(
      req.params['id'] as string,
      dto,
      auditContextFrom(req)
    );
    res.json(successResponse(user, 'Roles updated'));
  } catch (err) {
    next(err);
  }
}
