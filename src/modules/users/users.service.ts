import { PORTAL_ONLY_ROLES } from '@core/security/rbac.js';
import bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { revokeAllSessions } from '@modules/auth/index.js';
import { prisma } from '@infrastructure/database/index';
import { NotFoundError, ConflictError, ValidationError } from '@core/errors/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import type { CreateUserInput, UpdateUserInput, AssignRolesInput } from './users.dto.js';
import type { PaginationQueryInput } from '@modules/roles/roles.dto.js';
import type { Prisma } from '@prisma/client';
import { getEmailProvider } from '@infrastructure/email/index.js';
import { accountCreatedEmail } from './users.emails.js';
import { logAction, type AuditContext } from '@modules/audit/audit.service.js';
import { logger } from '@core/logger/index';
import { resolvePermissionsForRoles } from '@modules/roles/roles.service.js';
import {
  includesAdminRole,
  requireHeld,
  requireNotLastSuperAdmin,
  requireNotSelf,
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
  roles: Array<{ id: string; name: string }>;
}

export interface UserDetail extends Omit<UserSummary, 'roleCount'> {
  roles: Array<{ id: string; name: string }>;
  updatedAt: Date;
}

// ── List ─────────────────────────────────────────────────────────
export async function listUsers(
  query: PaginationQueryInput & { audience?: 'admin'; roleId?: string }
): Promise<PaginatedResult<UserSummary>> {
  const { page, limit, search, audience, roleId } = query;
  const offset = (page - 1) * limit;

  const where: Prisma.UserWhereInput = {
    deletedAt: null,
  };

  const and: Prisma.UserWhereInput[] = [];
  if (search)
    and.push({
      OR: [
        { email: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
      ],
    });
  // Student and faculty accounts have their own sections; someone with no role yet still shows
  if (audience === 'admin')
    and.push({
      OR: [
        { roles: { none: {} } },
        { roles: { some: { role: { name: { notIn: [...PORTAL_ONLY_ROLES] } } } } },
      ],
    });
  if (roleId) and.push({ roles: { some: { roleId } } });
  if (and.length) where.AND = and;

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
            role: { select: { name: true } },
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
    roles: u.roles.map((r) => ({ id: r.roleId, name: r.role.name })),
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
export async function createUser(
  dto: CreateUserInput,
  actor: Actor
): Promise<UserDetail & { welcomeEmailSent: boolean }> {
  // Deleted accounts keep their address (it is unique), so they count too
  const existing = await prisma.user.findFirst({ where: { email: dto.email } });
  if (existing) throw new ConflictError('Email is already in use');

  // Roles given at creation pass the same checks as assigning them later, before anything is written
  const roleIds = [...new Set(dto.roleIds ?? [])];
  if (roleIds.length) {
    const found = await prisma.role.findMany({
      where: { id: { in: roleIds }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== roleIds.length)
      throw new ValidationError('One or more roles were not found');
    const attempt = { entity: 'user', action: 'user.create', resourceId: dto.email };
    if (await includesAdminRole(prisma, roleIds)) await requireSuperAdmin(actor, attempt);
    await requireHeld(actor, await resolvePermissionsForRoles(roleIds), attempt);
  }

  const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      isActive: dto.isActive !== undefined ? dto.isActive : true,
      // The password was chosen by an admin: it works once, to sign in and set their own
      status: 'PENDING_ACTIVATION',
      // An admin entered this address and handed over the password, so there is no mailbox check to wait for
      emailVerifiedAt: new Date(),
      roles: {
        create: roleIds.map((roleId) => ({ roleId, assignedBy: actor.audit.actorId ?? null })),
      },
    },
  });

  await logAction({
    ...actor.audit,
    severity: 'INFO',
    entity: 'user',
    action: 'user.create',
    resourceId: user.id,
    newValue: { email: user.email, roleIds },
  });

  const detail = await getUserById(user.id);
  // The account exists either way; the admin is told if the details could not be mailed
  let welcomeEmailSent = true;
  try {
    await getEmailProvider().send(
      accountCreatedEmail({
        to: detail.email,
        fullName: detail.fullName,
        password: dto.password,
        roleNames: detail.roles.map((r) => r.name.replace(/_/g, ' ')),
      })
    );
  } catch (err) {
    welcomeEmailSent = false;
    logger.warn(
      { err: { message: (err as Error).message }, userId: user.id },
      'Welcome email failed'
    );
  }
  return { ...detail, welcomeEmailSent };
}

// ── Update (Admin) ────────────────────────────────────────────────
export async function updateUser(
  id: string,
  dto: UpdateUserInput,
  audit?: AuditContext
): Promise<UserDetail> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
  });
  if (!user) throw new NotFoundError('User');
  if (dto.isActive === false) await requireNotLastSuperAdmin(prisma, id);

  await prisma.user.update({
    where: { id },
    data: {
      fullName: dto.fullName !== undefined ? dto.fullName : undefined,
      isActive: dto.isActive !== undefined ? dto.isActive : undefined,
    },
  });

  if (dto.isActive !== undefined && dto.isActive !== user.isActive)
    await logAction({
      ...audit,
      severity: 'SECURITY',
      entity: 'user',
      action: dto.isActive ? 'user.activate' : 'user.deactivate',
      resourceId: id,
      previousValue: { email: user.email, isActive: user.isActive },
      newValue: { email: user.email, isActive: dto.isActive },
    });

  return getUserById(user.id);
}

// ── Delete (Soft) ─────────────────────────────────────────────────
export async function deleteUser(id: string, audit?: AuditContext): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
  });
  if (!user) throw new NotFoundError('User');
  await requireNotLastSuperAdmin(prisma, id);

  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await logAction({
    ...audit,
    severity: 'SECURITY',
    entity: 'user',
    action: 'user.delete',
    resourceId: id,
    previousValue: { email: user.email },
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
    requireNotSelf(actor, userId);
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
    requireNotSelf(actor, userId);
    previousRoles = await currentRoleNames(tx, userId);

    if (await includesAdminRole(tx, dto.roleIds))
      await requireSuperAdmin(actor, {
        entity: 'user',
        action: 'user.roles_changed',
        resourceId: userId,
      });
    if (await tx.role.count({ where: { id: { in: dto.roleIds }, name: 'super_admin' } }))
      await requireNotLastSuperAdmin(tx, userId);

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
    requireNotSelf(actor, userId);
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

    const dropped = currentIds.filter((id) => !dto.roleIds.includes(id));
    if (await tx.role.count({ where: { id: { in: dropped }, name: 'super_admin' } }))
      await requireNotLastSuperAdmin(tx, userId);

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

// ── Reset password (Admin) ────────────────────────────────────────
const randomPassword = (): string => {
  const pick = (chars: string) => chars[randomInt(chars.length)]!;
  const all = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  const chars = [pick('ABCDEFGHJKLMNPQRSTUVWXYZ'), pick('23456789'), pick('!@#$%&*')];
  while (chars.length < 14) chars.push(pick(all));
  return chars.sort(() => randomInt(3) - 1).join('');
};

/**
 * Sets a new random password, ends the person's sessions and emails it to them (it is never returned to the
 * admin). They must replace it at their next sign-in. Also the way to resend details after a lost email.
 */
export async function resetPassword(
  userId: string,
  actor: Actor
): Promise<{ welcomeEmailSent: boolean }> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: { roles: { include: { role: { select: { id: true, name: true } } } } },
  });
  if (!user) throw new NotFoundError('User');
  requireNotSelf(actor, userId);
  const attempt = { entity: 'user', action: 'user.password_reset', resourceId: userId };
  // Resetting an admin's password would be a way into their access
  if (
    await includesAdminRole(
      prisma,
      user.roles.map((r) => r.roleId)
    )
  )
    await requireSuperAdmin(actor, attempt);

  const password = randomPassword();
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      status: user.status === 'ACTIVE' ? 'PENDING_ACTIVATION' : user.status,
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  await revokeAllSessions(userId);
  await logAction({
    ...actor.audit,
    severity: 'SECURITY',
    entity: 'user',
    action: 'user.password_reset',
    resourceId: userId,
    newValue: { email: user.email },
  });

  try {
    await getEmailProvider().send(
      accountCreatedEmail({
        to: user.email,
        fullName: user.fullName,
        password,
        roleNames: user.roles.map((r) => r.role.name.replace(/_/g, ' ')),
        reset: true,
      })
    );
    return { welcomeEmailSent: true };
  } catch (err) {
    logger.warn({ err: { message: (err as Error).message }, userId }, 'Reset email failed');
    return { welcomeEmailSent: false };
  }
}
