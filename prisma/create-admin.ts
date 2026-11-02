import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../src/infrastructure/database/connection.js';
import { RegisterDto } from '../src/modules/auth/auth.dto.js';
import { seedRbac } from './seed-rbac.js';

/**
 * Creates the first super_admin from INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD (and an optional
 * INITIAL_ADMIN_NAME). There are no defaults: nothing is created unless both are set, and the
 * password follows the registration policy. Does nothing when a super_admin already exists, so it is
 * safe to run on every deployment. Run `npm run db:seed` first (it is repeated here if roles are missing).
 */
const InputSchema = z.object({
  email: RegisterDto.shape.email,
  password: RegisterDto.shape.password,
  fullName: RegisterDto.shape.fullName,
});

async function main() {
  const parsed = InputSchema.safeParse({
    email: process.env.INITIAL_ADMIN_EMAIL,
    password: process.env.INITIAL_ADMIN_PASSWORD,
    fullName: process.env.INITIAL_ADMIN_NAME || 'Platform Administrator',
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD (${problems.join('; ')})`);
  }

  const existing = await prisma.user.count({
    where: { deletedAt: null, roles: { some: { role: { name: 'super_admin' } } } },
  });
  if (existing > 0) {
    console.log('A super_admin already exists. Nothing to do.');
    return;
  }

  let role = await prisma.role.findUnique({ where: { name: 'super_admin' } });
  if (!role) {
    await seedRbac(prisma);
    role = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
  }

  const { email, password, fullName } = parsed.data;
  if (await prisma.user.findFirst({ where: { email } })) {
    throw new Error('That email already belongs to another account. Use a different email.');
  }

  await prisma.user.create({
    data: {
      email,
      fullName,
      passwordHash: await bcrypt.hash(password, 12),
      emailVerifiedAt: new Date(), // the portal login refuses unverified emails
      roles: { create: { roleId: role.id } },
    },
  });
  console.log(`Created super_admin ${email}. Sign in at the admin portal and change the password.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
