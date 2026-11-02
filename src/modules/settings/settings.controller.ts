import { Request, Response, NextFunction } from 'express';
import { successResponse } from '@core/response/index';
import { auditContextFrom } from '@middleware/audit.middleware';
import * as SettingsService from './settings.service.js';
import type { ListSettingsQuery, UpdateSettingInput } from './settings.dto.js';

// Query, params and body are validated by validateRequest in settings.routes.ts

export async function listSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await SettingsService.listSettings(req.query as unknown as ListSettingsQuery);
    res.json(successResponse(result.items, 'Settings retrieved', result.meta));
  } catch (err) {
    next(err);
  }
}

export async function getSetting(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const setting = await SettingsService.getSettingDetail(req.params['key'] as string);
    res.json(successResponse(setting, 'Setting retrieved'));
  } catch (err) {
    next(err);
  }
}

export async function updateSetting(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const setting = await SettingsService.updateSetting(
      req.params['key'] as string,
      req.body as UpdateSettingInput,
      auditContextFrom(req)
    );
    res.json(successResponse(setting, 'Setting updated'));
  } catch (err) {
    next(err);
  }
}
