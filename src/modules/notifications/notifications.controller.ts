import { Request, Response, NextFunction } from 'express';
import {
  CreateNotificationDto,
  UpdateNotificationDto,
  PaginationQueryDto,
} from './notifications.dto.js';
import * as NotificationsService from './notifications.service.js';
import { successResponse } from '@core/response/index';

export async function listNotifications(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = PaginationQueryDto.parse(req.query);
    const result = await NotificationsService.listNotifications(query);
    res.json(successResponse(result.items, 'Notifications retrieved', result.meta));
  } catch (err) {
    next(err);
  }
}

export async function getNotificationById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const item = await NotificationsService.getNotificationById(req.params['id'] as string);
    res.json(successResponse(item));
  } catch (err) {
    next(err);
  }
}

export async function createNotification(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = CreateNotificationDto.parse(req.body);
    const item = await NotificationsService.createNotification(dto);
    res.status(201).json(successResponse(item, 'Notification created'));
  } catch (err) {
    next(err);
  }
}

export async function updateNotification(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = UpdateNotificationDto.parse(req.body);
    const item = await NotificationsService.updateNotification(req.params['id'] as string, dto);
    res.json(successResponse(item, 'Notification updated'));
  } catch (err) {
    next(err);
  }
}

export async function deleteNotification(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await NotificationsService.deleteNotification(req.params['id'] as string);
    res.json(successResponse(null, 'Notification deleted'));
  } catch (err) {
    next(err);
  }
}
