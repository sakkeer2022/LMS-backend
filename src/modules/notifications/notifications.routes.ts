import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import * as NotificationsController from './notifications.controller.js';

export const notificationsRouter = Router();

// All routes require authentication
notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  requirePermission('notifications.read'),
  NotificationsController.listNotifications
);

notificationsRouter.get(
  '/:id',
  requirePermission('notifications.read'),
  NotificationsController.getNotificationById
);
notificationsRouter.post(
  '/',
  requirePermission('notifications.create'),
  NotificationsController.createNotification
);
notificationsRouter.patch(
  '/:id',
  requirePermission('notifications.update'),
  NotificationsController.updateNotification
);
notificationsRouter.delete(
  '/:id',
  requirePermission('notifications.delete'),
  NotificationsController.deleteNotification
);
