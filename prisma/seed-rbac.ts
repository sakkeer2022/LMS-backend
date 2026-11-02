import type { prisma as prismaClient } from '../src/infrastructure/database/connection.js';
import { GLOBAL_WILDCARD, PERMISSIONS, SYSTEM_ROLES } from '../src/core/security/rbac.js';

type Db = typeof prismaClient;

/**
 * Seeds permissions and system roles from src/core/security/rbac.ts.
 * Idempotent: re-running updates descriptions and adds missing grants. It never
 * removes grants, so permissions added by hand or by older seeds are kept.
 */
export async function seedRbac(db: Db): Promise<void> {
  const definitions = [
    ...PERMISSIONS,
    {
      name: GLOBAL_WILDCARD,
      resource: '*',
      action: '*',
      description: 'Every permission (super_admin only)',
    },
  ];

  for (const def of definitions) {
    await db.permission.upsert({
      where: { name: def.name },
      update: { resource: def.resource, action: def.action, description: def.description },
      create: def,
    });
  }

  const permissionIds = new Map(
    (await db.permission.findMany({ select: { id: true, name: true } })).map((p) => [p.name, p.id])
  );

  for (const role of SYSTEM_ROLES) {
    const dbRole = await db.role.upsert({
      where: { name: role.name },
      update: { description: role.description, isSystem: true },
      create: { name: role.name, description: role.description, isSystem: true, isActive: true },
    });

    await db.rolePermission.createMany({
      data: role.permissions.map((name) => {
        const permissionId = permissionIds.get(name);
        if (!permissionId) throw new Error(`Seed: unknown permission "${name}" for ${role.name}`);
        return { roleId: dbRole.id, permissionId };
      }),
      skipDuplicates: true,
    });
  }
}
