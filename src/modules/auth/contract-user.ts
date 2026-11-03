import type { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { NotFoundError } from '@core/errors/index';
import { PORTALS } from '@core/security/rbac';

/** The `User` schema of docs/openapi.yaml, as returned by the portal login and `GET /auth/me`. */
export interface ContractUser {
  id: string;
  email: string;
  fullName: string;
  mobileNumber: string | null;
  timezone: string | null;
  lastLoginAt: Date | null;
  isActive: boolean;
  emailVerified: boolean;
  roles: Array<{ id: string; name: string; permissions: Array<{ name: string }> }>;
}

/**
 * Loads a user in the contract shape. The contract's role names are the three portals, so a
 * `super_admin` role is shown as `admin` and a user holding both appears with one `admin` role.
 */
export async function loadContractUser(
  userId: string,
  tx?: Prisma.TransactionClient
): Promise<ContractUser> {
  const db = tx ?? prisma;
  const user = await db.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: {
      roles: {
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      },
    },
  });
  if (!user) throw new NotFoundError('User');

  const byName = new Map<string, ContractUser['roles'][number]>();
  for (const { role } of user.roles) {
    const name = role.name === 'super_admin' ? 'admin' : role.name;
    if (!(PORTALS as readonly string[]).includes(name)) continue;
    const entry = byName.get(name) ?? { id: role.id, name, permissions: [] };
    for (const rp of role.permissions) {
      if (!entry.permissions.some((p) => p.name === rp.permission.name)) {
        entry.permissions.push({ name: rp.permission.name });
      }
    }
    byName.set(name, entry);
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    mobileNumber: user.mobileNumber,
    timezone: user.timezone,
    lastLoginAt: user.lastLoginAt,
    isActive: user.isActive,
    emailVerified: user.emailVerifiedAt !== null,
    roles: [...byName.values()],
  };
}
