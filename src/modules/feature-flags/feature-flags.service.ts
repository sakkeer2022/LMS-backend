import { prisma } from '@infrastructure/database/index';
import { NotFoundError, ConflictError } from '@core/errors/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import type { CreateFeatureFlagInput, UpdateFeatureFlagInput } from './feature-flags.dto.js';
import type { PaginationQueryInput } from '@modules/roles/roles.dto.js';
import type { Prisma } from '@prisma/client';

export interface FeatureFlagDetail {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  rolloutPercentage: number;
  conditions: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── List ─────────────────────────────────────────────────────────
export async function listFeatureFlags(
  query: PaginationQueryInput
): Promise<PaginatedResult<FeatureFlagDetail>> {
  const { page, limit, search } = query;
  const offset = (page - 1) * limit;

  const where: Prisma.FeatureFlagWhereInput = {};

  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  const [count, rows] = await prisma.$transaction([
    prisma.featureFlag.count({ where }),
    prisma.featureFlag.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { name: 'asc' },
    }),
  ]);

  const items = rows.map(_toFeatureFlagDetail);
  return { items, meta: buildPaginationMeta(count, page, limit) };
}

// ── Get by ID ────────────────────────────────────────────────────
export async function getFeatureFlagById(id: string): Promise<FeatureFlagDetail> {
  const flag = await prisma.featureFlag.findUnique({
    where: { id },
  });
  if (!flag) throw new NotFoundError('FeatureFlag');
  return _toFeatureFlagDetail(flag);
}

// ── Create ────────────────────────────────────────────────────────
export async function createFeatureFlag(
  dto: CreateFeatureFlagInput,
  userId?: string | null
): Promise<FeatureFlagDetail> {
  const existing = await prisma.featureFlag.findUnique({
    where: { name: dto.name },
  });
  if (existing) throw new ConflictError(`Feature flag '${dto.name}' already exists`);

  const flag = await prisma.featureFlag.create({
    data: {
      name: dto.name,
      description: dto.description ?? null,
      isEnabled: dto.isEnabled,
      rolloutPercentage: dto.rolloutPercentage,
      conditions: dto.conditions ? (dto.conditions as Prisma.InputJsonValue) : undefined,
      createdBy: userId ?? null,
    },
  });

  return _toFeatureFlagDetail(flag);
}

// ── Update ────────────────────────────────────────────────────────
export async function updateFeatureFlag(
  id: string,
  dto: UpdateFeatureFlagInput
): Promise<FeatureFlagDetail> {
  const flag = await prisma.featureFlag.findUnique({
    where: { id },
  });
  if (!flag) throw new NotFoundError('FeatureFlag');

  if (dto.name && dto.name !== flag.name) {
    const existing = await prisma.featureFlag.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new ConflictError(`Feature flag '${dto.name}' already exists`);
  }

  const updated = await prisma.featureFlag.update({
    where: { id },
    data: {
      name: dto.name !== undefined ? dto.name : undefined,
      description: dto.description !== undefined ? dto.description : undefined,
      isEnabled: dto.isEnabled !== undefined ? dto.isEnabled : undefined,
      rolloutPercentage: dto.rolloutPercentage !== undefined ? dto.rolloutPercentage : undefined,
      conditions:
        dto.conditions !== undefined ? (dto.conditions as Prisma.InputJsonValue) : undefined,
    },
  });

  return _toFeatureFlagDetail(updated);
}

// ── Delete ────────────────────────────────────────────────────────
export async function deleteFeatureFlag(id: string): Promise<void> {
  const flag = await prisma.featureFlag.findUnique({
    where: { id },
  });
  if (!flag) throw new NotFoundError('FeatureFlag');

  await prisma.featureFlag.delete({
    where: { id },
  });
}

// ── Private helpers ───────────────────────────────────────────────
function _toFeatureFlagDetail(flag: {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  rolloutPercentage: number;
  conditions: unknown;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): FeatureFlagDetail {
  return {
    id: flag.id,
    name: flag.name,
    description: flag.description,
    isEnabled: flag.isEnabled,
    rolloutPercentage: flag.rolloutPercentage,
    conditions: flag.conditions as Record<string, unknown> | null,
    createdBy: flag.createdBy,
    createdAt: flag.createdAt,
    updatedAt: flag.updatedAt,
  };
}

// ── Evaluation ────────────────────────────────────────────────────
/**
 * True when the named flag exists and is enabled. A missing flag is off, so a new code
 * path stays dark until an admin creates and enables its flag. rolloutPercentage and
 * conditions are not evaluated yet; a flag is all-or-nothing.
 */
export async function isFeatureEnabled(name: string): Promise<boolean> {
  const flag = await prisma.featureFlag.findUnique({
    where: { name },
    select: { isEnabled: true },
  });
  return flag?.isEnabled ?? false;
}
