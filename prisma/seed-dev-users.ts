/**
 * Local development admin (LMS-64). Never runs in production: it requires
 * APP_ENV=development and refuses NODE_ENV=production (prisma/seeds/dev-admin.ts).
 * The password comes only from the environment; nothing is stored in the repo.
 * Requires the reference seed (`npm run db:seed`) first, for the roles.
 *
 *   APP_ENV=development
 *   DEV_ADMIN_EMAIL      optional, default admin@local.test
 *   DEV_ADMIN_PASSWORD   required, at least 12 characters
 *
 * Usage: npm run db:seed:users   (re-running resets the password and unlocks the account)
 */
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../src/infrastructure/database/connection.js';
import { parseDevAdminEnv, type DevAdminSettings } from './seeds/dev-admin.js';

const BCRYPT_ROUNDS = 12;

async function upsertAdmin(account: DevAdminSettings): Promise<void> {
  const role = await prisma.role.findUnique({ where: { name: 'admin' } });
  if (!role) throw new Error('Role "admin" is missing; run `npm run db:seed` first');

  const passwordHash = await bcrypt.hash(account.password, BCRYPT_ROUNDS);
  const user = await prisma.user.upsert({
    where: { email: account.email },
    update: {
      passwordHash,
      fullName: account.fullName,
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
    create: {
      email: account.email,
      passwordHash,
      fullName: account.fullName,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.userRole.upsert({
    where: { pk_user_roles: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
  console.log(`Seeded admin ${user.email}`);
}

async function main(): Promise<void> {
  await upsertAdmin(parseDevAdminEnv(process.env));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
