import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { expectContractResponse } from '../helpers/contract.js';
import { loginWithRole, TEST_PASSWORD, type LoggedInUser } from '../helpers/users.js';
import { requireRecentReauth } from '@middleware/require-reauth';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';

function reauth(user: LoggedInUser, body: object = { password: TEST_PASSWORD }) {
  return request(app)
    .post('/api/v1/auth/reauthenticate')
    .set('Authorization', `Bearer ${user.token}`)
    .set('Cookie', user.csrfCookie)
    .set('x-csrf-token', user.csrfToken)
    .send(body);
}

// A guarded probe: runs the middleware against a real session without a settings registry
async function guarded(user: LoggedInUser): Promise<number> {
  let status = 200;
  await requireRecentReauth(
    { user: { sub: user.userId, sid: await sidOf(user.userId) } } as never,
    {} as never,
    (err?: unknown) => {
      if (err) status = (err as { statusCode: number }).statusCode;
    }
  );
  return status;
}

async function sidOf(userId: string): Promise<string> {
  const row = await prisma.refreshToken.findFirstOrThrow({
    where: { userId, used: false },
    orderBy: { createdAt: 'desc' },
  });
  return row.familyId!;
}

describe('POST /auth/reauthenticate', () => {
  let user: LoggedInUser;

  beforeEach(async () => {
    await seedRbac(prisma);
    user = await loginWithRole('admin', 'reauth@example.com');
  });

  it('marks the session fresh, matches the contract and audits it', async () => {
    expect(await guarded(user)).toBe(403);

    const res = await reauth(user);
    expect(res.status).toBe(200);
    expectContractResponse(res, 'post', '/auth/reauthenticate');
    const until = new Date(res.body.data.reauthenticatedUntil).getTime();
    expect(until - Date.now()).toBeGreaterThan(4 * 60 * 1000);
    expect(until - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);

    expect(await guarded(user)).toBe(200);
    const entry = await prisma.auditLog.findFirst({ where: { action: 'reauth.success' } });
    expect(entry?.actorId).toBe(user.userId);
  });

  it('is bound to the session: another session of the same user stays stale', async () => {
    const other = await loginWithRole('admin', 'reauth-other@example.com');
    await reauth(user);
    expect(await guarded(other)).toBe(403);
  });

  it('stops being fresh after the window', async () => {
    await reauth(user);
    await prisma.refreshToken.updateMany({
      where: { userId: user.userId },
      data: { reauthenticatedAt: new Date(Date.now() - 6 * 60 * 1000) },
    });
    expect(await guarded(user)).toBe(403);
  });

  it('survives a token refresh without extending the window', async () => {
    await reauth(user);
    const before = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.userId } });

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${user.csrfCookie}; ${user.refreshCookie}`)
      .set('x-csrf-token', user.csrfToken);
    expect(res.status).toBe(200);

    const rows = await prisma.refreshToken.findMany({
      where: { userId: user.userId, used: false },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reauthenticatedAt?.getTime()).toBe(before.reauthenticatedAt!.getTime());
    expect(await guarded(user)).toBe(200);
  });

  it('returns 401 for a wrong password, counts it, never extends freshness and never logs it', async () => {
    const res = await reauth(user, { password: 'Wrong-pass1' });
    expect(res.status).toBe(401);
    expect(await guarded(user)).toBe(403);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(fresh.failedLoginAttempts).toBe(1);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'reauth.failed' } });
    expect(JSON.stringify([entry.newValue, entry.resourceId])).not.toContain('Wrong-pass1');
  });

  it('returns 429 once failed attempts lock the account', async () => {
    for (let i = 0; i < 5; i++) await reauth(user, { password: 'Wrong-pass1' });

    const res = await reauth(user);
    expect(res.status).toBe(429);
    expect(await guarded(user)).toBe(403);
  });

  it('does not extend freshness for a failed check after a successful one', async () => {
    await reauth(user);
    await prisma.refreshToken.updateMany({
      where: { userId: user.userId },
      data: { reauthenticatedAt: new Date(Date.now() - 6 * 60 * 1000) },
    });
    await reauth(user, { password: 'Wrong-pass1' });
    expect(await guarded(user)).toBe(403);
  });

  it('requires a signed-in session, a CSRF token and a valid body', async () => {
    const anonymous = await request(app)
      .post('/api/v1/auth/reauthenticate')
      .set('Cookie', user.csrfCookie)
      .set('x-csrf-token', user.csrfToken)
      .send({ password: TEST_PASSWORD });
    expect(anonymous.status).toBe(401);

    const noCsrf = await request(app)
      .post('/api/v1/auth/reauthenticate')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: TEST_PASSWORD });
    expect(noCsrf.status).toBe(403);

    expect((await reauth(user, {})).status).toBe(422);
    expect((await reauth(user, { password: TEST_PASSWORD, extra: 1 })).status).toBe(422);
  });
});
