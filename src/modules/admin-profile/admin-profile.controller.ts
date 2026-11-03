import type { NextFunction, Request, Response } from 'express';
import { successResponse } from '@core/response/index';
import { paginationQuerySchema } from '@shared/validation/index';
import { AdminProfileUpdateDto } from './admin-profile.dto.js';
import * as AdminProfileService from './admin-profile.service.js';

function auditContext(req: Request) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || 'unknown-ip',
    userAgent: req.headers['user-agent'] || 'unknown-agent',
  };
}

export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = AdminProfileUpdateDto.parse(req.body);
    const user = await AdminProfileService.updateProfile(req.user!.sub, input, auditContext(req));
    res.json(successResponse(user, 'Profile updated'));
  } catch (err) {
    next(err);
  }
}

export async function listActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = paginationQuerySchema.parse(req.query);
    const { events, meta } = await AdminProfileService.listOwnActivity(req.user!.sub, query);
    res.set('Cache-Control', 'no-store');
    res.json(successResponse(events, 'Activity retrieved', meta));
  } catch (err) {
    next(err);
  }
}
