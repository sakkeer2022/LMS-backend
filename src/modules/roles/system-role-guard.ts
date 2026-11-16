import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { ConflictError, ForbiddenError } from '@core/errors/index';
import { hasPermission } from '@core/security/rbac.js';
import { logger } from '@core/logger/index';
import { auditContextFrom } from '@middleware/audit.middleware';
import { logAction, type AuditContext } from '@modules/audit/audit.service.js';

/** Roles that carry admin power: granting, removing or inheriting from them is for super_admin only (LMS-104). */
const ADMIN_ROLES = ['super_admin', 'admin'];

export interface Actor {
  roles: string[];
  permissions: string[];
  audit: AuditContext;
}

export const actorFrom = (req: Request): Actor => ({
  roles: req.user?.roles ?? [],
  permissions: req.user?.permissions ?? [],
  audit: auditContextFrom(req),
});

type Db = Pick<Prisma.TransactionClient, 'role'>;

export async function includesAdminRole(db: Db, roleIds: string[]): Promise<boolean> {
  if (roleIds.length === 0) return false;
  const count = await db.role.count({
    where: { id: { in: roleIds }, isSystem: true, name: { in: ADMIN_ROLES } },
  });
  return count > 0;
}

type Attempt = { entity: string; action: string; resourceId: string };

async function deny(actor: Actor, attempt: Attempt, message: string): Promise<never> {
  try {
    await logAction({
      ...actor.audit,
      severity: 'SECURITY',
      ...attempt,
      action: `${attempt.action}_denied`,
    });
  } catch (err) {
    logger.error({ err, ...attempt }, 'Failed to write denied role change audit log');
  }
  throw new ForbiddenError(message);
}

/** Rejects with 403 unless the actor is super_admin, and records the refused attempt in the audit log. */
export async function requireSuperAdmin(actor: Actor, attempt: Attempt): Promise<void> {
  if (!actor.roles.includes('super_admin'))
    await deny(actor, attempt, 'Only a super admin can change system roles');
}

/** Nobody but super_admin can hand out a permission they do not hold themselves. */
export async function requireHeld(
  actor: Actor,
  permissions: string[],
  attempt: Attempt
): Promise<void> {
  if (actor.roles.includes('super_admin')) return;
  if (permissions.some((name) => !hasPermission(actor.permissions, name)))
    await deny(actor, attempt, 'You cannot grant permissions you do not hold');
}

/** Nobody changes their own roles, so access can only be widened or narrowed by someone else. */
export function requireNotSelf(actor: Actor, userId: string): void {
  if (actor.audit.actorId === userId) throw new ForbiddenError('You cannot change your own roles');
}

type UserDb = Pick<Prisma.TransactionClient, 'user'>;

/**
 * The last active super_admin must stay: refuses when `userId` is one and no other active super_admin exists.
 * Call before anything that removes the role from, deactivates or deletes that user.
 */
export async function requireNotLastSuperAdmin(db: UserDb, userId: string): Promise<void> {
  const holds = (id: string) => ({
    id,
    deletedAt: null,
    isActive: true,
    status: { notIn: ['INACTIVE', 'SUSPENDED'] as ('INACTIVE' | 'SUSPENDED')[] },
    roles: {
      some: { role: { name: 'super_admin', isSystem: true, isActive: true, deletedAt: null } },
    },
  });
  if ((await db.user.count({ where: holds(userId) })) === 0) return;
  const others = await db.user.count({
    where: { ...holds(userId), id: { not: userId } } as Prisma.UserWhereInput,
  });
  if (others === 0)
    throw new ConflictError('The last active super admin cannot be removed or deactivated');
}
