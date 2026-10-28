import { Request, Response, NextFunction } from 'express';
import { AuditLogQueryDto } from './audit.dto.js';
import * as AuditService from './audit.service.js';
import { successResponse } from '@core/response/index';

export async function listAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = AuditLogQueryDto.parse(req.query);
    const result = await AuditService.listAuditLogs(query);
    res.json(successResponse(result.items, 'Audit logs retrieved', result.meta));
  } catch (err) {
    next(err);
  }
}

export async function getAuditLogById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const log = await AuditService.getAuditLogById(req.params['id'] as string);
    res.json(successResponse(log));
  } catch (err) {
    next(err);
  }
}
