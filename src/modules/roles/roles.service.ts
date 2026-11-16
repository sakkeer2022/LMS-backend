import { prisma } from '@infrastructure/database/index';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '@core/errors/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import type {
  CreateRoleInput,
  UpdateRoleInput,
  AssignPermissionsInput,
  RoleListQueryInput,
} from './roles.dto.js';
import type { Prisma } from '@prisma/client';
import { PORTAL_ONLY_ROLES } from '@core/security/rbac.js';
import { logAction } from '@modules/audit/audit.service.js';
import { logger } from '@core/logger/index';
import type { PolicyRule } from '../../core/security/policy.js';
import {
  includesAdminRole,
  requireHeld,
  requireSuperAdmin,
  type Actor,
} from './system-role-guard.js';

/** The seeded super_admin role always holds every permission, so it can never be edited, deactivated or deleted. */
function assertEditable(role: { name: string; isSystem: boolean }): void {
  if (role.isSystem && role.name === 'super_admin')
    throw new ForbiddenError('The super_admin role cannot be changed');
}

/** RBAC changes are security-relevant: record who changed what, after the commit. */
async function recordRoleAudit(
  actor: Actor,
  action: string,
  roleId: string,
  previousValue: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null
): Promise<void> {
  try {
    await logAction({
      ...actor.audit,
      severity: 'SECURITY',
      entity: 'role',
      action,
      resourceId: roleId,
      previousValue,
      newValue,
    });
  } catch (err) {
    logger.error({ err, roleId, action }, 'Failed to write role audit log');
  }
}

const roleFields = (r: {
  name: string;
  description: string | null;
  isActive: boolean;
  parentId: string | null;
}) => ({
  name: r.name,
  description: r.description,
  isActive: r.isActive,
  parentId: r.parentId,
});

async function permissionNames(roleId: string): Promise<string[]> {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { name: true } } },
  });
  return rows.map((r) => r.permission.name).sort();
}

/** Runs a permission change and audits the before and after permission names. */
async function auditedPermissions(
  actor: Actor,
  action: string,
  roleId: string,
  run: () => Promise<RoleDetail>
): Promise<RoleDetail> {
  const before = await permissionNames(roleId);
  const result = await run();
  await recordRoleAudit(
    actor,
    action,
    roleId,
    { permissions: before },
    { permissions: result.permissions.map((p) => p.name).sort() }
  );
  return result;
}

// ── Shapes returned to controllers ───────────────────────────────
export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  parentId: string | null;
  permissionCount: number;
  userCount: number;
  createdAt: Date;
}

export interface RoleDetail extends Omit<RoleSummary, 'permissionCount' | 'userCount'> {
  permissions: Array<{
    id: string;
    name: string;
    resource: string;
    action: string;
    conditions?: unknown;
  }>;
  updatedAt: Date;
}

// Helper to check for cyclical inheritance tree
async function checkCycle(roleId: string, parentId: string): Promise<boolean> {
  let currentId: string | null = parentId;
  const visited = new Set<string>([roleId]);

  while (currentId) {
    if (visited.has(currentId)) {
      return true; // Cycle detected
    }
    visited.add(currentId);

    const parentRole: { parentId: string | null } | null = await prisma.role.findFirst({
      where: { id: currentId, deletedAt: null },
      select: { parentId: true },
    });

    currentId = parentRole?.parentId || null;
  }
  return false;
}

// ── List ─────────────────────────────────────────────────────────
export async function listRoles(query: RoleListQueryInput): Promise<PaginatedResult<RoleSummary>> {
  const { page, limit, search, audience } = query;
  const offset = (page - 1) * limit;

  const where: Prisma.RoleWhereInput = {
    deletedAt: null,
    ...(audience === 'admin' && {
      NOT: { isSystem: true, name: { in: [...PORTAL_ONLY_ROLES] } },
    }),
  };

  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  const [count, rows] = await prisma.$transaction([
    prisma.role.count({ where }),
    prisma.role.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { name: 'asc' },
      include: {
        permissions: {
          select: {
            permissionId: true,
          },
        },
        _count: { select: { users: true } },
      },
    }),
  ]);

  const items: RoleSummary[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    isActive: r.isActive,
    parentId: r.parentId,
    permissionCount: r.permissions.length,
    userCount: r._count.users,
    createdAt: r.createdAt,
  }));

  return { items, meta: buildPaginationMeta(count, page, limit) };
}

// ── Get by ID ────────────────────────────────────────────────────
export async function getRoleById(id: string): Promise<RoleDetail> {
  const role = await prisma.role.findFirst({
    where: { id, deletedAt: null },
    include: {
      permissions: {
        include: {
          permission: {
            select: { id: true, name: true, resource: true, action: true },
          },
        },
      },
    },
  });

  if (!role) throw new NotFoundError('Role');

  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isActive: role.isActive,
    parentId: role.parentId,
    permissions: role.permissions.map((rp) => ({
      ...rp.permission,
      conditions: rp.conditions || undefined,
    })),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

// ── Create ────────────────────────────────────────────────────────
export async function createRole(dto: CreateRoleInput, actor: Actor): Promise<RoleDetail> {
  const existing = await prisma.role.findFirst({
    where: { name: dto.name, deletedAt: null },
  });
  if (existing) throw new ConflictError(`Role '${dto.name}' already exists`);

  if (dto.parentId) {
    const parentRole = await prisma.role.findFirst({
      where: { id: dto.parentId, deletedAt: null },
    });
    if (!parentRole) {
      throw new NotFoundError('Parent role');
    }
    // A role inheriting from an admin role would carry its permissions
    if (await includesAdminRole(prisma, [dto.parentId]))
      await requireSuperAdmin(actor, {
        entity: 'role',
        action: 'role.system_changed',
        resourceId: dto.parentId,
      });
    await requireHeld(actor, await resolvePermissionsForRoles([dto.parentId]), {
      entity: 'role',
      action: 'role.permissions_granted',
      resourceId: dto.parentId,
    });
  }

  const role = await prisma.role.create({
    data: {
      name: dto.name,
      description: dto.description ?? null,
      isSystem: false,
      isActive: true,
      parentId: dto.parentId ?? null,
    },
  });

  const created = await getRoleById(role.id);
  await recordRoleAudit(actor, 'role.create', role.id, null, roleFields(created));
  return created;
}

// ── Update ────────────────────────────────────────────────────────
export async function updateRole(
  id: string,
  dto: UpdateRoleInput,
  actor: Actor
): Promise<RoleDetail> {
  const role = await prisma.role.findFirst({
    where: { id, deletedAt: null },
  });
  if (!role) throw new NotFoundError('Role');
  assertEditable(role);
  if (role.isSystem)
    await requireSuperAdmin(actor, {
      entity: 'role',
      action: 'role.system_changed',
      resourceId: id,
    });

  if (role.isSystem && dto.name && dto.name !== role.name) {
    throw new ForbiddenError('Cannot rename a system role');
  }

  if (dto.name && dto.name !== role.name) {
    const existing = await prisma.role.findFirst({
      where: { name: dto.name, deletedAt: null },
    });
    if (existing) throw new ConflictError(`Role '${dto.name}' already exists`);
  }

  if (dto.parentId !== undefined) {
    if (dto.parentId === id) {
      throw new ValidationError('A role cannot be its own parent');
    }
    if (dto.parentId) {
      const parentRole = await prisma.role.findFirst({
        where: { id: dto.parentId, deletedAt: null },
      });
      if (!parentRole) {
        throw new NotFoundError('Parent role');
      }
      if (await includesAdminRole(prisma, [dto.parentId]))
        await requireSuperAdmin(actor, {
          entity: 'role',
          action: 'role.system_changed',
          resourceId: id,
        });
      await requireHeld(actor, await resolvePermissionsForRoles([dto.parentId]), {
        entity: 'role',
        action: 'role.permissions_granted',
        resourceId: dto.parentId,
      });
      const hasCycle = await checkCycle(id, dto.parentId);
      if (hasCycle) {
        throw new ValidationError('Role inheritance cycle detected');
      }
    }
  }

  await prisma.role.update({
    where: { id },
    data: {
      name: dto.name !== undefined ? dto.name : undefined,
      description: dto.description !== undefined ? dto.description : undefined,
      isActive: dto.isActive !== undefined ? dto.isActive : undefined,
      parentId: dto.parentId !== undefined ? dto.parentId : undefined,
    },
  });

  const updated = await getRoleById(role.id);
  await recordRoleAudit(actor, 'role.update', id, roleFields(role), roleFields(updated));
  return updated;
}

// ── Delete ────────────────────────────────────────────────────────
export async function deleteRole(id: string, actor: Actor): Promise<void> {
  const role = await prisma.role.findFirst({
    where: { id, deletedAt: null },
  });
  if (!role) throw new NotFoundError('Role');
  if (role.isSystem) throw new ForbiddenError('Cannot delete a system role');
  const users = await prisma.userRole.count({ where: { roleId: id } });
  if (users > 0)
    throw new ConflictError(
      `This role is assigned to ${users} user${users === 1 ? '' : 's'}. Remove it from them before deleting it.`
    );

  await prisma.role.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await recordRoleAudit(actor, 'role.delete', id, roleFields(role), null);
}

// ── Assign permissions (additive) ─────────────────────────────────
export const assignPermissions = (
  roleId: string,
  dto: AssignPermissionsInput,
  actor: Actor
): Promise<RoleDetail> =>
  auditedPermissions(actor, 'role.permissions_added', roleId, () =>
    assignPermissionsTx(roleId, dto, actor)
  );

async function assignPermissionsTx(
  roleId: string,
  dto: AssignPermissionsInput,
  actor: Actor
): Promise<RoleDetail> {
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findFirst({
      where: { id: roleId, deletedAt: null },
    });
    if (!role) throw new NotFoundError('Role');
    assertEditable(role);
    if (role.isSystem)
      await requireSuperAdmin(actor, {
        entity: 'role',
        action: 'role.system_changed',
        resourceId: roleId,
      });

    const permissions = await tx.permission.findMany({
      where: { id: { in: dto.permissionIds } },
    });

    if (permissions.length !== dto.permissionIds.length) {
      const found = permissions.map((p) => p.id);
      const missing = dto.permissionIds.filter((id) => !found.includes(id));
      throw new ValidationError(`Permissions not found: ${missing.join(', ')}`);
    }
    await requireHeld(
      actor,
      permissions.map((p) => p.name),
      { entity: 'role', action: 'role.permissions_granted', resourceId: roleId }
    );

    await tx.rolePermission.createMany({
      data: dto.permissionIds.map((permissionId) => ({
        roleId,
        permissionId,
      })),
      skipDuplicates: true,
    });

    // Retrieve and format update
    const updatedRole = await tx.role.findFirst({
      where: { id: roleId },
      include: {
        permissions: {
          include: {
            permission: {
              select: { id: true, name: true, resource: true, action: true },
            },
          },
        },
      },
    });

    if (!updatedRole) throw new NotFoundError('Role');

    return {
      id: updatedRole.id,
      name: updatedRole.name,
      description: updatedRole.description,
      isSystem: updatedRole.isSystem,
      isActive: updatedRole.isActive,
      parentId: updatedRole.parentId,
      permissions: updatedRole.permissions.map((rp) => ({
        ...rp.permission,
        conditions: rp.conditions || undefined,
      })),
      createdAt: updatedRole.createdAt,
      updatedAt: updatedRole.updatedAt,
    };
  });
}

// ── Remove permissions ────────────────────────────────────────────
export const removePermissions = (
  roleId: string,
  dto: AssignPermissionsInput,
  actor: Actor
): Promise<RoleDetail> =>
  auditedPermissions(actor, 'role.permissions_removed', roleId, () =>
    removePermissionsTx(roleId, dto, actor)
  );

async function removePermissionsTx(
  roleId: string,
  dto: AssignPermissionsInput,
  actor: Actor
): Promise<RoleDetail> {
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findFirst({
      where: { id: roleId, deletedAt: null },
    });
    if (!role) throw new NotFoundError('Role');
    assertEditable(role);
    if (role.isSystem)
      await requireSuperAdmin(actor, {
        entity: 'role',
        action: 'role.system_changed',
        resourceId: roleId,
      });

    await tx.rolePermission.deleteMany({
      where: {
        roleId,
        permissionId: { in: dto.permissionIds },
      },
    });

    const updatedRole = await tx.role.findFirst({
      where: { id: roleId },
      include: {
        permissions: {
          include: {
            permission: {
              select: { id: true, name: true, resource: true, action: true },
            },
          },
        },
      },
    });

    if (!updatedRole) throw new NotFoundError('Role');

    return {
      id: updatedRole.id,
      name: updatedRole.name,
      description: updatedRole.description,
      isSystem: updatedRole.isSystem,
      isActive: updatedRole.isActive,
      parentId: updatedRole.parentId,
      permissions: updatedRole.permissions.map((rp) => ({
        ...rp.permission,
        conditions: rp.conditions || undefined,
      })),
      createdAt: updatedRole.createdAt,
      updatedAt: updatedRole.updatedAt,
    };
  });
}

// ── Set permissions (replace all) ─────────────────────────────────
export const setPermissions = (
  roleId: string,
  dto: AssignPermissionsInput,
  actor: Actor
): Promise<RoleDetail> =>
  auditedPermissions(actor, 'role.permissions_set', roleId, () =>
    setPermissionsTx(roleId, dto, actor)
  );

async function setPermissionsTx(
  roleId: string,
  dto: AssignPermissionsInput,
  actor: Actor
): Promise<RoleDetail> {
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findFirst({
      where: { id: roleId, deletedAt: null },
    });
    if (!role) throw new NotFoundError('Role');
    assertEditable(role);
    if (role.isSystem)
      await requireSuperAdmin(actor, {
        entity: 'role',
        action: 'role.system_changed',
        resourceId: roleId,
      });

    const permissions = await tx.permission.findMany({
      where: { id: { in: dto.permissionIds } },
    });

    if (permissions.length !== dto.permissionIds.length) {
      const found = permissions.map((p) => p.id);
      const missing = dto.permissionIds.filter((id) => !found.includes(id));
      throw new ValidationError(`Permissions not found: ${missing.join(', ')}`);
    }
    await requireHeld(
      actor,
      permissions.map((p) => p.name),
      { entity: 'role', action: 'role.permissions_granted', resourceId: roleId }
    );

    await tx.rolePermission.deleteMany({
      where: { roleId },
    });

    await tx.rolePermission.createMany({
      data: dto.permissionIds.map((permissionId) => ({
        roleId,
        permissionId,
      })),
    });

    const updatedRole = await tx.role.findFirst({
      where: { id: roleId },
      include: {
        permissions: {
          include: {
            permission: {
              select: { id: true, name: true, resource: true, action: true },
            },
          },
        },
      },
    });

    if (!updatedRole) throw new NotFoundError('Role');

    return {
      id: updatedRole.id,
      name: updatedRole.name,
      description: updatedRole.description,
      isSystem: updatedRole.isSystem,
      isActive: updatedRole.isActive,
      parentId: updatedRole.parentId,
      permissions: updatedRole.permissions.map((rp) => ({
        ...rp.permission,
        conditions: rp.conditions || undefined,
      })),
      createdAt: updatedRole.createdAt,
      updatedAt: updatedRole.updatedAt,
    };
  });
}

export async function resolvePoliciesForRoles(roleIds: string[]): Promise<PolicyRule[]> {
  const policies: PolicyRule[] = [];
  const visitedRoles = new Set<string>();

  async function traverse(roleId: string): Promise<void> {
    if (visitedRoles.has(roleId)) return;
    visitedRoles.add(roleId);

    const role = await prisma.role.findFirst({
      where: { id: roleId, deletedAt: null, isActive: true },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role) return;

    for (const rp of role.permissions) {
      const parts = rp.permission.name.split(/[.:]/);
      if (parts.length >= 2) {
        policies.push({
          subject: parts[0],
          action: parts[1],
          conditions: (rp.conditions as PolicyRule['conditions']) || undefined,
        });
      }
    }

    if (role.parentId) {
      await traverse(role.parentId);
    }
  }

  for (const roleId of roleIds) {
    await traverse(roleId);
  }

  return policies;
}

export async function resolvePermissionsForRoles(roleIds: string[]): Promise<string[]> {
  const permissionsSet = new Set<string>();
  const visitedRoles = new Set<string>();

  async function traverse(roleId: string): Promise<void> {
    if (visitedRoles.has(roleId)) return;
    visitedRoles.add(roleId);

    const role = await prisma.role.findFirst({
      where: { id: roleId, deletedAt: null, isActive: true },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role) return;

    for (const rp of role.permissions) {
      permissionsSet.add(rp.permission.name);
    }

    if (role.parentId) {
      await traverse(role.parentId);
    }
  }

  for (const roleId of roleIds) {
    await traverse(roleId);
  }

  return Array.from(permissionsSet);
}
