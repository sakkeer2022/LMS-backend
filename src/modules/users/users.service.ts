import bcrypt from 'bcrypt';
import { prisma } from '@infrastructure/database/index';
import { NotFoundError, ConflictError, ValidationError } from '@core/errors/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import type { CreateUserInput, UpdateUserInput, AssignRolesInput } from './users.dto.js';
import type { PaginationQueryInput } from '@modules/roles/roles.dto.js';
import type { Prisma } from '@prisma/client';
import { logAction, type AuditContext } from '@modules/audit/audit.service.js';
import { logger } from '@core/logger/index';
import { resolvePermissionsForRoles } from '@modules/roles/roles.service.js';
import {
  includesAdminRole,
  requireHeld,
  requireSuperAdmin,
  type Actor,
} from '@modules/roles/system-role-guard.js';

const BCRYPT_ROUNDS = 12;

// ── Shapes returned to controllers ───────────────────────────────
export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roleCount: number;
}

export interface UserDetail extends Omit<UserSummary, 'roleCount'> {
  roles: Array<{ id: string; name: string }>;
  updatedAt: Date;
}

// ── List ─────────────────────────────────────────────────────────
export async function listUsers(
  query: PaginationQueryInput
): Promise<PaginatedResult<UserSummary>> {
  const { page, limit, search } = query;
  const offset = (page - 1) * limit;

  const where: Prisma.UserWhereInput = {
    deletedAt: null,
  };

  if (search) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { fullName: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [count, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        roles: {
          select: {
            roleId: true,
          },
        },
      },
    }),
  ]);

  const items: UserSummary[] = rows.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    roleCount: u.roles.length,
  }));

  return { items, meta: buildPaginationMeta(count, page, limit) };
}

// ── Get by ID ────────────────────────────────────────────────────
export async function getUserById(id: string): Promise<UserDetail> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: {
      roles: {
        include: {
          role: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  if (!user) throw new NotFoundError('User');
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    roles: user.roles.map((ur) => ur.role),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// ── Create (Admin) ────────────────────────────────────────────────
export async function createUser(dto: CreateUserInput): Promise<UserDetail> {
  const existing = await prisma.user.findFirst({
    where: { email: dto.email, deletedAt: null },
  });
  if (existing) throw new ConflictError('Email is already in use');

  const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      isActive: dto.isActive !== undefined ? dto.isActive : true,
    },
  });

  return getUserById(user.id);
}

// ── Update (Admin) ────────────────────────────────────────────────
export async function updateUser(id: string, dto: UpdateUserInput): Promise<UserDetail> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
  });
  if (!user) throw new NotFoundError('User');

  await prisma.user.update({
    where: { id },
    data: {
      fullName: dto.fullName !== undefined ? dto.fullName : undefined,
      isActive: dto.isActive !== undefined ? dto.isActive : undefined,
    },
  });

  return getUserById(user.id);
}

// ── Delete (Soft) ─────────────────────────────────────────────────
export async function deleteUser(id: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
  });
  if (!user) throw new NotFoundError('User');

  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ── Role Management ───────────────────────────────────────────────

async function currentRoleNames(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const rows = await tx.userRole.findMany({
    where: { userId },
    select: { role: { select: { name: true } } },
  });
  return rows.map((r) => r.role.name).sort();
}

// Role changes are security-relevant (LMS-38): record who changed what, after the commit.
async function recordRoleChange(
  action: string,
  userId: string,
  previousRoles: string[],
  user: UserDetail,
  audit?: AuditContext
): Promise<void> {
  try {
    await logAction({
      ...audit,
      severity: 'SECURITY',
      entity: 'user',
      action,
      resourceId: userId,
      previousValue: { roles: previousRoles },
      newValue: { roles: user.roles.map((r) => r.name).sort() },
    });
  } catch (err) {
    logger.error({ err, userId, action }, 'Failed to write role change audit log');
  }
}

export async function assignRoles(
  userId: string,
  dto: AssignRolesInput,
  actor: Actor
): Promise<UserDetail> {
  let previousRoles: string[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundError('User');
    previousRoles = await currentRoleNames(tx, userId);

    const roles = await tx.role.findMany({
      where: { id: { in: dto.roleIds }, deletedAt: null },
    });

    if (roles.length !== dto.roleIds.length) {
      const found = roles.map((r) => r.id);
      const missing = dto.roleIds.filter((id) => !found.includes(id));
      throw new ValidationError(`Roles not found: ${missing.join(', ')}`);
    }

    if (await includesAdminRole(tx, dto.roleIds))
      await requireSuperAdmin(actor, {
        entity: 'user',
        action: 'user.roles_changed',
        resourceId: userId,
      });

    await requireHeld(actor, await resolvePermissionsForRoles(dto.roleIds), {
      entity: 'user',
      action: 'user.roles_changed',
      resourceId: userId,
    });

    await tx.userRole.createMany({
      data: dto.roleIds.map((roleId) => ({
        userId,
        roleId,
      })),
      skipDuplicates: true,
    });

    // Fetch and return the updated user details
    const updatedUser = await tx.user.findFirst({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!updatedUser) throw new NotFoundError('User');

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      fullName: updatedUser.fullName,
      isActive: updatedUser.isActive,
      lastLoginAt: updatedUser.lastLoginAt,
      roles: updatedUser.roles.map((ur) => ur.role),
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    };
  });

  await recordRoleChange('user.roles_assigned', userId, previousRoles, result, actor.audit);
  return result;
}

export async function removeRoles(
  userId: string,
  dto: AssignRolesInput,
  actor: Actor
): Promise<UserDetail> {
  let previousRoles: string[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundError('User');
    previousRoles = await currentRoleNames(tx, userId);

    if (await includesAdminRole(tx, dto.roleIds))
      await requireSuperAdmin(actor, {
        entity: 'user',
        action: 'user.roles_changed',
        resourceId: userId,
      });

    await tx.userRole.deleteMany({
      where: {
        userId,
        roleId: { in: dto.roleIds },
      },
    });

    const updatedUser = await tx.user.findFirst({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!updatedUser) throw new NotFoundError('User');

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      fullName: updatedUser.fullName,
      isActive: updatedUser.isActive,
      lastLoginAt: updatedUser.lastLoginAt,
      roles: updatedUser.roles.map((ur) => ur.role),
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    };
  });

  await recordRoleChange('user.roles_removed', userId, previousRoles, result, actor.audit);
  return result;
}

export async function setRoles(
  userId: string,
  dto: AssignRolesInput,
  actor: Actor
): Promise<UserDetail> {
  let previousRoles: string[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundError('User');
    previousRoles = await currentRoleNames(tx, userId);

    const roles = await tx.role.findMany({
      where: { id: { in: dto.roleIds }, deletedAt: null },
    });

    if (roles.length !== dto.roleIds.length) {
      const found = roles.map((r) => r.id);
      const missing = dto.roleIds.filter((id) => !found.includes(id));
      throw new ValidationError(`Roles not found: ${missing.join(', ')}`);
    }

    const currentIds = (
      await tx.userRole.findMany({ where: { userId }, select: { roleId: true } })
    ).map((r) => r.roleId);
    const changedIds = [
      ...dto.roleIds.filter((id) => !currentIds.includes(id)),
      ...currentIds.filter((id) => !dto.roleIds.includes(id)),
    ];
    if (await includesAdminRole(tx, changedIds))
      await requireSuperAdmin(actor, {
        entity: 'user',
        action: 'user.roles_changed',
        resourceId: userId,
      });

    await requireHeld(
      actor,
      await resolvePermissionsForRoles(dto.roleIds.filter((id) => !currentIds.includes(id))),
      {
        entity: 'user',
        action: 'user.roles_changed',
        resourceId: userId,
      }
    );

    await tx.userRole.deleteMany({
      where: { userId },
    });

    await tx.userRole.createMany({
      data: dto.roleIds.map((roleId) => ({
        userId,
        roleId,
      })),
    });

    const updatedUser = await tx.user.findFirst({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!updatedUser) throw new NotFoundError('User');

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      fullName: updatedUser.fullName,
      isActive: updatedUser.isActive,
      lastLoginAt: updatedUser.lastLoginAt,
      roles: updatedUser.roles.map((ur) => ur.role),
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    };
  });

  await recordRoleChange('user.roles_replaced', userId, previousRoles, result, actor.audit);
  return result;
}
