import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { expectContractResponse } from '../helpers/contract.js';
import { TEST_PASSWORD } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';

const PORTALS = ['student', 'faculty', 'admin'] as const;
type Portal = (typeof PORTALS)[number];

async function createUser(
  email: string,
  roleName: string,
  overrides: Partial<{
    emailVerifiedAt: Date | null;
    isActive: boolean;
    status: 'PENDING_ACTIVATION';
  }> = {}
) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  return prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      fullName: `${roleName} test`,
      emailVerifiedAt: new Date(),
      roles: { create: { roleId: role.id } },
      ...overrides,
    },
  });
}

async function login(portal: Portal, email: string, password = TEST_PASSWORD) {
  const { csrfToken, csrfCookie } = await getCsrfData();
  return request(app)
    .post(`/api/v1/auth/${portal}/login`)
    .set('Cookie', csrfCookie)
    .set('x-csrf-token', csrfToken)
    .send({ email, password });
}

const cookiesOf = (res: request.Response): string[] =>
  (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];

describe('Portal login', () => {
  beforeEach(async () => {
    await seedRbac(prisma);
  });

  describe.each([
    ['student', 'student'],
    ['faculty', 'faculty'],
    ['admin', 'admin'],
  ] as const)('%s portal', (portal, roleName) => {
    it('signs in a user with the portal role and matches the contract', async () => {
      await createUser(`${portal}@example.com`, roleName);
      const res = await login(portal, `${portal}@example.com`);

      expect(res.status).toBe(200);
      expectContractResponse(res, 'post', `/auth/${portal}/login`);
      expect(res.body.data.user.email).toBe(`${portal}@example.com`);
      expect(res.body.data.user.emailVerified).toBe(true);
      expect(res.body.data.user.roles.map((r: { name: string }) => r.name)).toEqual([portal]);
      expect(res.body.data.requiresPasswordChange).toBe(false);
      expect(cookiesOf(res).some((c) => c.startsWith('accessToken='))).toBe(true);
      expect(cookiesOf(res).some((c) => c.startsWith('refreshToken='))).toBe(true);
    });

    it('stores the portal and a session family on the refresh token', async () => {
      const user = await createUser(`${portal}-row@example.com`, roleName);
      await login(portal, `${portal}-row@example.com`);

      const row = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(row.portal).toBe(portal);
      expect(row.familyId).toBeTruthy();
    });

    it('rejects a user who only holds another portal role, like a wrong password', async () => {
      const otherRole = PORTALS.find((p) => p !== portal)!;
      await createUser(`${portal}-other@example.com`, otherRole);

      const wrongPortal = await login(portal, `${portal}-other@example.com`);
      const wrongPassword = await login(otherRole, `${portal}-other@example.com`, 'Wrong-pass1');

      expect(wrongPortal.status).toBe(401);
      expect(wrongPortal.body).toEqual(wrongPassword.body);
      expect(cookiesOf(wrongPortal).some((c) => c.startsWith('accessToken='))).toBe(false);
    });
  });

  it('lets a super_admin sign in to the admin portal only', async () => {
    await createUser('root@example.com', 'super_admin');

    const admin = await login('admin', 'root@example.com');
    expect(admin.status).toBe(200);
    expect(admin.body.data.user.roles.map((r: { name: string }) => r.name)).toEqual(['admin']);
    expect((await login('student', 'root@example.com')).status).toBe(401);
  });

  it('returns the same 401 for unknown, wrong-password, locked and inactive accounts', async () => {
    await createUser('known@example.com', 'student');
    await createUser('off@example.com', 'student', { isActive: false });

    const unknown = await login('student', 'nobody@example.com');
    const wrong = await login('student', 'known@example.com', 'Wrong-pass1');
    const inactive = await login('student', 'off@example.com');

    for (const res of [unknown, wrong, inactive]) {
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
      expect(cookiesOf(res)).toEqual([]);
    }
  });

  it('locks the account after repeated wrong passwords, even for the right password', async () => {
    await createUser('lock@example.com', 'student');
    for (let i = 0; i < 5; i++) await login('student', 'lock@example.com', 'Wrong-pass1');

    const res = await login('student', 'lock@example.com');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('does not count a wrong portal as a failed attempt', async () => {
    const user = await createUser('wrongportal@example.com', 'student');
    for (let i = 0; i < 6; i++) await login('faculty', 'wrongportal@example.com');

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.failedLoginAttempts).toBe(0);
    expect((await login('student', 'wrongportal@example.com')).status).toBe(200);
  });

  it('returns 403 for an unverified email when the password and portal are right', async () => {
    await createUser('unverified@example.com', 'student', { emailVerifiedAt: null });

    const res = await login('student', 'unverified@example.com');
    expect(res.status).toBe(403);
    expect(cookiesOf(res)).toEqual([]);
    // Wrong portal must not reveal that the password was right
    expect((await login('faculty', 'unverified@example.com')).status).toBe(401);
  });

  it('flags a pending-activation account as requiring a password change', async () => {
    await createUser('pending@example.com', 'faculty', { status: 'PENDING_ACTIVATION' });
    const res = await login('faculty', 'pending@example.com');
    expect(res.status).toBe(200);
    expect(res.body.data.requiresPasswordChange).toBe(true);
  });

  it('rejects unknown fields and a missing password with 422', async () => {
    await createUser('strict@example.com', 'student');
    const { csrfToken, csrfCookie } = await getCsrfData();
    const post = (body: object) =>
      request(app)
        .post('/api/v1/auth/student/login')
        .set('Cookie', csrfCookie)
        .set('x-csrf-token', csrfToken)
        .send(body);

    expect(
      (await post({ email: 'strict@example.com', password: TEST_PASSWORD, role: 'admin' })).status
    ).toBe(422);
    expect((await post({ email: 'strict@example.com' })).status).toBe(422);
  });

  it('rejects a login without a CSRF token with 403', async () => {
    await createUser('csrf@example.com', 'student');
    const res = await request(app)
      .post('/api/v1/auth/student/login')
      .send({ email: 'csrf@example.com', password: TEST_PASSWORD });
    expect(res.status).toBe(403);
  });

  describe('audit', () => {
    it('records a successful login with the portal and no password', async () => {
      const user = await createUser('audit-ok@example.com', 'student');
      await login('student', 'audit-ok@example.com');

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'login.success', actorId: user.id },
      });
      expect(entry.entity).toBe('auth');
      expect(JSON.stringify(entry.newValue)).not.toContain(TEST_PASSWORD);
      expect(entry.newValue).toEqual({ portal: 'student' });
    });

    it('records failures with the reason, and the actor when the account is known', async () => {
      const user = await createUser('audit-bad@example.com', 'student');
      await login('student', 'audit-bad@example.com', 'Wrong-pass1');
      await login('student', 'audit-nobody@example.com');
      await login('faculty', 'audit-bad@example.com');

      const entries = await prisma.auditLog.findMany({
        where: { action: 'login.failed' },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.map((e) => (e.newValue as { reason: string }).reason)).toEqual([
        'wrong_password',
        'unknown_account',
        'wrong_portal',
      ]);
      expect(entries.map((e) => e.actorId)).toEqual([user.id, null, user.id]);
      expect(JSON.stringify(entries.map((e) => e.newValue))).not.toContain('Wrong-pass1');
    });
  });
});
