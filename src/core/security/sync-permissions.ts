import { prisma } from '@infrastructure/database/index';
import { logger } from '@core/logger/index';
import { GLOBAL_WILDCARD, PERMISSIONS } from './rbac.js';

/**
 * Upserts every key of the PERMISSIONS registry into the `permissions` table on startup, so a module that
 * registers a key needs no migration or seed run. It only adds or refreshes permissions: it never touches
 * roles or grants (super_admin holds `*`, so it has new keys at once), and removes nothing.
 */
export async function syncPermissionRegistry(): Promise<void> {
  const all = [
    ...PERMISSIONS,
    {
      name: GLOBAL_WILDCARD,
      resource: '*',
      action: '*',
      description: 'Every permission (super_admin only)',
    },
  ];
  for (const def of all) {
    await prisma.permission.upsert({
      where: { name: def.name },
      update: { resource: def.resource, action: def.action, description: def.description },
      create: def,
    });
  }
  logger.info({ count: all.length }, 'Permission registry synced');
}
