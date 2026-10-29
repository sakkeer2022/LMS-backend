/**
 * Local and test login accounts (LMS-64). Never run in production.
 * Credentials come only from the environment; nothing is stored in the repo.
 * Requires the reference seed (`npx prisma db seed`) first, for the roles.
 *
 *   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD   an `admin` account (catalogue.manage, pricing.manage)
 *
 * Usage: npm run db:seed:users
 */
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../src/infrastructure/database/connection.js';

const BCRYPT_ROUNDS = 12;

const EnvDto = z.object({
  NODE_ENV: z.string().optional(),
  SEED_ADMIN_EMAIL: z.email(),
  SEED_ADMIN_PASSWORD: z.string().min(12, 'SEED_ADMIN_PASSWORD must be at least 12 characters'),
  SEED_ADMIN_NAME: z.string().trim().min(1).max(150).default('Local Admin'),
});

async function upsertUser(
  account: { email: string; password: string; fullName: string },
  roleName: string
): Promise<void> {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) throw new Error(`Role "${roleName}" is missing; run the reference seed first`);

  const passwordHash = await bcrypt.hash(account.password, BCRYPT_ROUNDS);
  const user = await prisma.user.upsert({
    where: { email: account.email.toLowerCase() },
    // Re-running resets the password and unlocks the account
    update: {
      passwordHash,
      fullName: account.fullName,
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
    create: {
      email: account.email.toLowerCase(),
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
  console.log(`Seeded ${roleName} ${user.email}`);
}

async function main(): Promise<void> {
  const env = EnvDto.parse(process.env);
  if (env.NODE_ENV === 'production')
    throw new Error('Refusing to seed login accounts in production');
  await upsertUser(
    {
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
      fullName: env.SEED_ADMIN_NAME,
    },
    'admin'
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof z.ZodError ? z.prettifyError(e) : e);
    await prisma.$disconnect();
    process.exit(1);
  });
