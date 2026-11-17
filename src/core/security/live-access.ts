import { prisma } from '@infrastructure/database/index';
import type { PolicyRule } from './policy.js';
import {
  resolvePermissionsForRoles,
  resolvePoliciesForRoles,
} from '@modules/roles/roles.service.js';

export interface LiveAccess {
  roles: string[];
  permissions: string[];
  policies: PolicyRule[];
  /** An admin-set password the person has not replaced yet */
  mustChangePassword: boolean;
}

/**
 * Current roles and effective permissions of a user, read from the database (never from a token).
 * Returns null when the account is deleted, inactive or suspended, so the caller denies the request.
 * Roles that are inactive or deleted contribute nothing (see resolvePermissionsForRoles).
 * Only the admin portal calls this (see RBAC_LIVE_ADMIN); student and faculty sessions keep token claims.
 * shortcut: no cache, a few indexed queries per admin request; add one only with cross-instance invalidation.
 */
export async function loadLiveAccess(userId: string): Promise<LiveAccess | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      isActive: true,
      status: true,
      roles: {
        select: { role: { select: { id: true, name: true, isActive: true, deletedAt: true } } },
      },
    },
  });
  if (!user || !user.isActive || user.status === 'INACTIVE' || user.status === 'SUSPENDED')
    return null;

  const active = user.roles.map((ur) => ur.role).filter((r) => r.isActive && !r.deletedAt);
  const ids = active.map((r) => r.id);
  return {
    roles: active.map((r) => r.name),
    permissions: await resolvePermissionsForRoles(ids),
    policies: await resolvePoliciesForRoles(ids),
    mustChangePassword: user.status === 'PENDING_ACTIVATION',
  };
}
