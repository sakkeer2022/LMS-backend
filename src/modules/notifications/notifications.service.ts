import { prisma } from '@infrastructure/database/index';
import { NotFoundError } from '@core/errors/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import type { CreateNotificationInput, UpdateNotificationInput } from './notifications.dto.js';
import type { PaginationQueryInput } from '@modules/roles/roles.dto.js';
import type { Prisma } from '@prisma/client';

export interface NotificationDetail {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function listNotifications(
  query: PaginationQueryInput
): Promise<PaginatedResult<NotificationDetail>> {
  const { page, limit, search } = query;
  const offset = (page - 1) * limit;
  const where: Prisma.NotificationWhereInput = {};

  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  const [count, rows] = await prisma.$transaction([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const items = rows.map(_toNotificationDetail);
  return { items, meta: buildPaginationMeta(count, page, limit) };
}

export async function getNotificationById(id: string): Promise<NotificationDetail> {
  const item = await prisma.notification.findUnique({ where: { id } });
  if (!item) throw new NotFoundError('Notification');
  return _toNotificationDetail(item);
}

export async function createNotification(
  dto: CreateNotificationInput
): Promise<NotificationDetail> {
  const item = await prisma.notification.create({
    data: {
      name: dto.name,
      description: dto.description ?? null,
    },
  });
  return _toNotificationDetail(item);
}

export async function updateNotification(
  id: string,
  dto: UpdateNotificationInput
): Promise<NotificationDetail> {
  const item = await prisma.notification.findUnique({ where: { id } });
  if (!item) throw new NotFoundError('Notification');

  const updated = await prisma.notification.update({
    where: { id },
    data: {
      name: dto.name ?? undefined,
      description: dto.description !== undefined ? dto.description : undefined,
    },
  });
  return _toNotificationDetail(updated);
}

export async function deleteNotification(id: string): Promise<void> {
  const item = await prisma.notification.findUnique({ where: { id } });
  if (!item) throw new NotFoundError('Notification');

  await prisma.notification.delete({ where: { id } });
}

function _toNotificationDetail(item: {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): NotificationDetail {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
