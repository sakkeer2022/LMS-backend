import { beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { expectContractResponse } from '../helpers/contract.js';
import { latestOtp } from '../helpers/email.js';
import { TEST_PASSWORD, loginWithRole } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';
import { getTestOutbox } from '@infrastructure/email/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';

const API = '/api/v1/auth';
const NEW_PASSWORD = 'Brand-new-pass1';

async function post(path: string, body: unknown, cookie = '') {
  const { csrfToken, csrfCookie } = await getCsrfData();
  return request(app)
    .post(`${API}${path}`)
    .set('Cookie', [csrfCookie, cookie].filter(Boolean))
    .set('x-csrf-token', csrfToken)
    .send(body as object);
}

async function createUser(
  email: string,
  roleName: string,
  extra: Record<string, unknown> = {}
): Promise<{ id: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  return prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      fullName: `${roleName} test`,
      emailVerifiedAt: new Date(),
      roles: { create: { roleId: role.id } },
      ...extra,
    },
  });
}

// Runs the first two steps and returns the reset credential
async function startReset(email: string, portal: string): Promise<string> {
  const requested = await post('/recovery/requests', { email, portal });
  expect(requested.status).toBe(202);
  const verified = await post('/recovery/verify', {
    challengeId: requested.body.data.challengeId,
    otp: latestOtp(email),
  });
  expect(verified.status).toBe(200);
  return verified.body.data.resetCredential as string;
}

describe('account recovery', () => {
  beforeEach(async () => {
    await seedRbac(prisma);
    getTestOutbox().clear();
  });

  it.each([
    ['student', 'student'],
    ['faculty', 'faculty'],
    ['admin', 'admin'],
  ] as const)('recovers a %s account end to end', async (portal, role) => {
    const email = `${portal}@example.org`;
    await createUser(email, role);

    const requested = await post('/recovery/requests', { email, portal });
    expect(requested.status).toBe(202);
    expectContractResponse(requested, 'post', '/auth/recovery/requests');
    const code = latestOtp(email);
    expect(JSON.stringify(requested.body)).not.toContain(code);

    const verified = await post('/recovery/verify', {
      challengeId: requested.body.data.challengeId,
      otp: code,
    });
    expect(verified.status).toBe(200);
    expect(verified.headers['cache-control']).toContain('no-store');
    expectContractResponse(verified, 'post', '/auth/recovery/verify');

    const reset = await post('/recovery/reset', {
      resetCredential: verified.body.data.resetCredential,
      newPassword: NEW_PASSWORD,
    });
    expect(reset.status).toBe(200);
    expectContractResponse(reset, 'post', '/auth/recovery/reset');
    expect((reset.headers['set-cookie'] as unknown as string[]).join(';')).toContain(
      'accessToken=;'
    );

    const login = await post(`/${portal}/login`, { email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect((await post(`/${portal}/login`, { email, password: TEST_PASSWORD })).status).toBe(401);
  });

  it('answers an unknown email, a wrong portal and an inactive account like a real one, and sends nothing', async () => {
    await createUser('student@example.org', 'student');
    await createUser('off@example.org', 'student', { status: 'INACTIVE', isActive: false });

    for (const body of [
      { email: 'nobody@example.org', portal: 'student' },
      { email: 'student@example.org', portal: 'admin' },
      { email: 'off@example.org', portal: 'student' },
    ]) {
      const res = await post('/recovery/requests', body);
      expect(res.status).toBe(202);
      expectContractResponse(res, 'post', '/auth/recovery/requests');
      const verify = await post('/recovery/verify', {
        challengeId: res.body.data.challengeId,
        otp: '123456',
      });
      expect(verify.status).toBe(422);
    }
    expect(getTestOutbox().outbox).toHaveLength(0);
  });

  it('a reset credential works once', async () => {
    await createUser('once@example.org', 'student');
    const resetCredential = await startReset('once@example.org', 'student');
    expect(
      (await post('/recovery/reset', { resetCredential, newPassword: NEW_PASSWORD })).status
    ).toBe(200);
    expect(
      (await post('/recovery/reset', { resetCredential, newPassword: 'Another-pass2' })).status
    ).toBe(422);
  });

  it('lets only one of two simultaneous resets succeed', async () => {
    await createUser('race@example.org', 'student');
    const resetCredential = await startReset('race@example.org', 'student');
    const results = await Promise.all([
      post('/recovery/reset', { resetCredential, newPassword: NEW_PASSWORD }),
      post('/recovery/reset', { resetCredential, newPassword: 'Another-pass2' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
  });

  it('rejects an expired credential, an unknown one and the old password', async () => {
    const user = await createUser('expiry@example.org', 'student');
    const resetCredential = await startReset('expiry@example.org', 'student');
    expect(
      (await post('/recovery/reset', { resetCredential: 'nope', newPassword: NEW_PASSWORD })).status
    ).toBe(422);
    expect(
      (await post('/recovery/reset', { resetCredential, newPassword: TEST_PASSWORD })).status
    ).toBe(422);
    await prisma.passwordResetGrant.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (await post('/recovery/reset', { resetCredential, newPassword: NEW_PASSWORD })).status
    ).toBe(422);
  });

  it('a new request cancels the previous reset credential', async () => {
    await createUser('cancel@example.org', 'student');
    const first = await startReset('cancel@example.org', 'student');
    await prisma.emailChallenge.updateMany({ data: { resendCooldownUntil: new Date(0) } });
    await post('/recovery/requests', { email: 'cancel@example.org', portal: 'student' });
    expect(
      (await post('/recovery/reset', { resetCredential: first, newPassword: NEW_PASSWORD })).status
    ).toBe(422);
  });

  it('ends every session and cancels other credentials after a reset', async () => {
    const signedIn = await loginWithRole('student', 'sessions@example.org');
    const resetCredential = await startReset('sessions@example.org', 'student');
    await post('/recovery/reset', { resetCredential, newPassword: NEW_PASSWORD });

    const me = await request(app).get(`${API}/me`).set('Authorization', `Bearer ${signedIn.token}`);
    expect(me.status).toBe(401);
    const refresh = await post('/refresh', {}, signedIn.refreshCookie);
    expect(refresh.status).toBe(401);
    expect(
      await prisma.refreshToken.count({ where: { userId: signedIn.userId, revokedAt: null } })
    ).toBe(0);
    expect(
      await prisma.emailChallenge.count({ where: { userId: signedIn.userId, consumedAt: null } })
    ).toBe(0);
  });

  it('lets an account waiting for activation set its first password', async () => {
    const user = await createUser('invited@example.org', 'faculty', {
      status: 'PENDING_ACTIVATION',
    });
    const resetCredential = await startReset('invited@example.org', 'faculty');
    expect(
      (await post('/recovery/reset', { resetCredential, newPassword: NEW_PASSWORD })).status
    ).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('ACTIVE');
  });

  it('records the reset in the audit log', async () => {
    const user = await createUser('audit@example.org', 'student');
    const resetCredential = await startReset('audit@example.org', 'student');
    await post('/recovery/reset', { resetCredential, newPassword: NEW_PASSWORD });
    const row = await prisma.auditLog.findFirst({
      where: { action: 'password.reset', resourceId: user.id },
    });
    expect(row).not.toBeNull();
  });

  it('applies the password rule and rejects unknown fields', async () => {
    await createUser('rule@example.org', 'student');
    const resetCredential = await startReset('rule@example.org', 'student');
    for (const newPassword of ['short1', 'nonumberhere', `${'a1'.repeat(37)}`]) {
      expect((await post('/recovery/reset', { resetCredential, newPassword })).status).toBe(422);
    }
    expect(
      (await post('/recovery/requests', { email: 'a@example.org', portal: 'student', x: 1 })).status
    ).toBe(422);
    expect(
      (await post('/recovery/requests', { email: 'a@example.org', portal: 'owner' })).status
    ).toBe(422);
  });

  it('requires a CSRF token', async () => {
    const res = await request(app)
      .post(`${API}/recovery/requests`)
      .send({ email: 'a@example.org', portal: 'student' });
    expect(res.status).toBe(403);
  });
});

describe('change password', () => {
  beforeEach(async () => {
    await seedRbac(prisma);
  });

  async function change(
    token: string,
    body: unknown,
    csrf?: { csrfToken: string; csrfCookie: string }
  ) {
    const { csrfToken, csrfCookie } = csrf ?? (await getCsrfData());
    return request(app)
      .put(`${API}/password`)
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken)
      .send(body as object);
  }

  it('changes the password, ends every session and clears the cookies', async () => {
    const me = await loginWithRole('faculty', 'change@example.org');

    const res = await change(me.token, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);
    expectContractResponse(res, 'put', '/auth/password');
    expect((res.headers['set-cookie'] as unknown as string[]).join(';')).toContain(
      'refreshToken=;'
    );

    expect(
      (await request(app).get(`${API}/me`).set('Authorization', `Bearer ${me.token}`)).status
    ).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: me.userId, revokedAt: null } })).toBe(
      0
    );
    expect(
      (await post('/faculty/login', { email: 'change@example.org', password: NEW_PASSWORD })).status
    ).toBe(200);
    const row = await prisma.auditLog.findFirst({
      where: { action: 'password.changed', resourceId: me.userId },
    });
    expect(row).not.toBeNull();
  });

  it('rejects a wrong current password and counts it toward the lockout', async () => {
    const me = await loginWithRole('student', 'wrong@example.org');
    const res = await change(me.token, {
      currentPassword: 'Not-my-pass1',
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(422);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: me.userId } })).failedLoginAttempts
    ).toBe(1);
  });

  it('rejects an unchanged or weak new password', async () => {
    const me = await loginWithRole('student', 'same@example.org');
    expect(
      (await change(me.token, { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD }))
        .status
    ).toBe(422);
    expect(
      (await change(me.token, { currentPassword: TEST_PASSWORD, newPassword: 'short' })).status
    ).toBe(422);
    expect(
      (
        await change(me.token, {
          currentPassword: TEST_PASSWORD,
          newPassword: NEW_PASSWORD,
          extra: 1,
        })
      ).status
    ).toBe(422);
  });

  it('requires a signed-in user and a CSRF token', async () => {
    const csrf = await getCsrfData();
    const anonymous = await request(app)
      .put(`${API}/password`)
      .set('Cookie', csrf.csrfCookie)
      .set('x-csrf-token', csrf.csrfToken)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(anonymous.status).toBe(401);
    const me = await loginWithRole('student', 'csrf@example.org');
    const noCsrf = await request(app)
      .put(`${API}/password`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(noCsrf.status).toBe(403);
  });
});

describe('change password with an email code', () => {
  beforeEach(async () => {
    await seedRbac(prisma);
    getTestOutbox().clear();
  });

  async function authed(
    method: 'put' | 'post',
    path: string,
    token: string,
    body?: unknown
  ): Promise<request.Response> {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const call = request(app)
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken);
    return body === undefined ? call.send() : call.send(body as object);
  }

  async function askCode(
    token: string,
    email: string
  ): Promise<{ challengeId: string; otp: string }> {
    const res = await authed('post', '/password/requests', token);
    expect(res.status).toBe(202);
    return { challengeId: res.body.data.challengeId as string, otp: latestOtp(email) };
  }

  it("sends the code to the account's own email and changes the password with it", async () => {
    const admin = await loginWithRole('admin', 'boss@example.org');
    const res = await authed('post', '/password/requests', admin.token);
    expect(res.status).toBe(202);
    expectContractResponse(res, 'post', '/auth/password/requests');
    const code = latestOtp('boss@example.org');
    expect(getTestOutbox().to('boss@example.org')).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain(code);

    const changed = await authed('put', '/password', admin.token, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
      challengeId: res.body.data.challengeId,
      otp: code,
    });
    expect(changed.status).toBe(200);
    expectContractResponse(changed, 'put', '/auth/password');
    expect(
      (await post('/admin/login', { email: 'boss@example.org', password: NEW_PASSWORD })).status
    ).toBe(200);
    expect(
      await prisma.refreshToken.count({ where: { userId: admin.userId, revokedAt: null } })
    ).toBe(1);
  });

  it('refuses an admin change without a code, and a wrong or reused code', async () => {
    const admin = await loginWithRole('admin', 'nocode@example.org');
    const base = { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD };
    expect((await authed('put', '/password', admin.token, base)).status).toBe(422);

    const { challengeId, otp } = await askCode(admin.token, 'nocode@example.org');
    const wrong = otp === '000000' ? '111111' : '000000';
    expect(
      (await authed('put', '/password', admin.token, { ...base, challengeId, otp: wrong })).status
    ).toBe(422);
    expect(
      (await authed('put', '/password', admin.token, { ...base, challengeId, otp })).status
    ).toBe(200);
    // The code was used up by the successful change
    const again = await prisma.emailChallenge.findUniqueOrThrow({ where: { id: challengeId } });
    expect(again.consumedAt).not.toBeNull();
  });

  it('checks the current password first, so a wrong one does not use up the code', async () => {
    const admin = await loginWithRole('admin', 'order@example.org');
    const { challengeId, otp } = await askCode(admin.token, 'order@example.org');
    const bad = await authed('put', '/password', admin.token, {
      currentPassword: 'Not-my-pass1',
      newPassword: NEW_PASSWORD,
      challengeId,
      otp,
    });
    expect(bad.status).toBe(422);
    const row = await prisma.emailChallenge.findUniqueOrThrow({ where: { id: challengeId } });
    expect(row.consumedAt).toBeNull();
    const ok = await authed('put', '/password', admin.token, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
      challengeId,
      otp,
    });
    expect(ok.status).toBe(200);
  });

  it('does not accept a recovery code, or a code that belongs to another account', async () => {
    const admin = await loginWithRole('admin', 'purpose@example.org');
    const other = await loginWithRole('admin', 'other-admin@example.org');
    const base = { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD };

    const recovery = await post('/recovery/requests', {
      email: 'purpose@example.org',
      portal: 'admin',
    });
    const recoveryCode = latestOtp('purpose@example.org');
    expect(
      (
        await authed('put', '/password', admin.token, {
          ...base,
          challengeId: recovery.body.data.challengeId,
          otp: recoveryCode,
        })
      ).status
    ).toBe(422);

    const theirs = await askCode(other.token, 'other-admin@example.org');
    expect((await authed('put', '/password', admin.token, { ...base, ...theirs })).status).toBe(
      422
    );
  });

  it('rate limits asking again, and needs a signed-in user', async () => {
    const admin = await loginWithRole('admin', 'again@example.org');
    expect((await authed('post', '/password/requests', admin.token)).status).toBe(202);
    expect((await authed('post', '/password/requests', admin.token)).status).toBe(429);
    const csrf = await getCsrfData();
    const anonymous = await request(app)
      .post(`${API}/password/requests`)
      .set('Cookie', csrf.csrfCookie)
      .set('x-csrf-token', csrf.csrfToken);
    expect(anonymous.status).toBe(401);
    const noCsrf = await request(app)
      .post(`${API}/password/requests`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(noCsrf.status).toBe(403);
  });

  it('is not offered to accounts that do not need a code', async () => {
    const student = await loginWithRole('student', 'plain@example.org');
    expect((await authed('post', '/password/requests', student.token)).status).toBe(422);
    expect(getTestOutbox().outbox).toHaveLength(0);
  });
});
