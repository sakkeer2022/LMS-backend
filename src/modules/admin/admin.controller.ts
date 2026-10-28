import { Request, Response, NextFunction } from 'express';
import { AdminUserParamsDto, ToggleUserStatusBodyDto } from './admin.dto.js';
import * as AdminService from './admin.service.js';
import { successResponse } from '@core/response/index';

export async function getStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await AdminService.getAdminStats();
    res.json(successResponse(stats, 'Admin portal statistics retrieved'));
  } catch (err) {
    next(err);
  }
}

export async function getHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const health = await AdminService.getSystemHealth();
    res.json(successResponse(health, 'System health report retrieved'));
  } catch (err) {
    next(err);
  }
}

export async function unlockUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = AdminUserParamsDto.parse(req.params);

    const ip = req.ip ?? req.socket.remoteAddress;
    const ipAddress = (Array.isArray(ip) ? ip[0] : ip) as string | undefined;
    const userAgent = req.get('User-Agent');

    await AdminService.unlockUserAccount(params.id, req.user?.sub, ipAddress, userAgent);

    res.json(successResponse(null, 'User account successfully unlocked'));
  } catch (err) {
    next(err);
  }
}

export async function setUserActiveState(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const params = AdminUserParamsDto.parse(req.params);
    const body = ToggleUserStatusBodyDto.parse(req.body);

    const ip = req.ip ?? req.socket.remoteAddress;
    const ipAddress = (Array.isArray(ip) ? ip[0] : ip) as string | undefined;
    const userAgent = req.get('User-Agent');

    await AdminService.toggleUserActiveState(
      params.id,
      body.isActive,
      req.user?.sub,
      ipAddress,
      userAgent
    );

    const message = body.isActive
      ? 'User account successfully activated'
      : 'User account successfully deactivated';

    res.json(successResponse(null, message));
  } catch (err) {
    next(err);
  }
}
