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
    res.json(successResponse(result.items, 'Audit events retrieved', result.meta));
  } catch (err) {
    next(err);
  }
}
