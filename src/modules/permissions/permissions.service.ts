import { prisma } from '@infrastructure/database/index';
import { NotFoundError, ConflictError } from '@core/errors/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import type { CreatePermissionInput, UpdatePermissionInput } from './permissions.dto.js';
import type { PaginationQueryInput } from '@modules/roles/roles.dto.js';
import type { Prisma } from '@prisma/client';

export interface PermissionDetail {
  id: string;
  name: string;
  resource: string;
  action: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── List ─────────────────────────────────────────────────────────
export async function listPermissions(
  query: PaginationQueryInput
): Promise<PaginatedResult<PermissionDetail>> {
  const { page, limit, search } = query;
  const offset = (page - 1) * limit;

  const where: Prisma.PermissionWhereInput = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { resource: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [count, rows] = await prisma.$transaction([
    prisma.permission.count({ where }),
    prisma.permission.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    }),
  ]);

  const items = rows.map(_toPermissionDetail);
  return { items, meta: buildPaginationMeta(count, page, limit) };
}

// ── Get by ID ────────────────────────────────────────────────────
export async function getPermissionById(id: string): Promise<PermissionDetail> {
  const permission = await prisma.permission.findUnique({
    where: { id },
  });
  if (!permission) throw new NotFoundError('Permission');
  return _toPermissionDetail(permission);
}

// ── Create ────────────────────────────────────────────────────────
export async function createPermission(dto: CreatePermissionInput): Promise<PermissionDetail> {
  const existing = await prisma.permission.findUnique({
    where: { name: dto.name },
  });
  if (existing) throw new ConflictError(`Permission '${dto.name}' already exists`);

  const permission = await prisma.permission.create({
    data: {
      name: dto.name,
      resource: dto.resource,
      action: dto.action,
      description: dto.description ?? null,
    },
  });

  return _toPermissionDetail(permission);
}

// ── Update ────────────────────────────────────────────────────────
export async function updatePermission(
  id: string,
  dto: UpdatePermissionInput
): Promise<PermissionDetail> {
  const permission = await prisma.permission.findUnique({
    where: { id },
  });
  if (!permission) throw new NotFoundError('Permission');

  const updated = await prisma.permission.update({
    where: { id },
    data: {
      description: dto.description !== undefined ? dto.description : undefined,
    },
  });

  return _toPermissionDetail(updated);
}

// ── Delete ────────────────────────────────────────────────────────
export async function deletePermission(id: string): Promise<void> {
  const permission = await prisma.permission.findUnique({
    where: { id },
  });
  if (!permission) throw new NotFoundError('Permission');

  // Hard delete because permissions generally shouldn't accumulate ghost records
  await prisma.permission.delete({
    where: { id },
  });
}

// ── Private helpers ───────────────────────────────────────────────
function _toPermissionDetail(permission: {
  id: string;
  name: string;
  resource: string;
  action: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PermissionDetail {
  return {
    id: permission.id,
    name: permission.name,
    resource: permission.resource,
    action: permission.action,
    description: permission.description,
    createdAt: permission.createdAt,
    updatedAt: permission.updatedAt,
  };
}
