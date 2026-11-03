import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { expectContractResponse } from '../helpers/contract.js';
import { loginWithRole, TEST_PASSWORD, type LoggedInUser } from '../helpers/users.js';
import { getCsrfData } from '../helpers/csrf.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';

const bearer = (u: LoggedInUser) => ({ Authorization: `Bearer ${u.token}` });

function refresh(refreshCookie: string, csrf: { csrfToken: string; csrfCookie: string }) {
  return request(app)
    .post('/api/v1/auth/refresh')
    .set('Cookie', `${csrf.csrfCookie}; ${refreshCookie}`)
    .set('x-csrf-token', csrf.csrfToken);
}

const cookieOf = (res: request.Response, name: string): string =>
  (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith(`${name}=`))!
    .split(';')[0]!;

/** Another device: a different user agent, so it is a separate session rather than a replacement */
async function secondLogin(
  email: string,
  portal: string,
  userAgent = 'Second Device/1.0'
): Promise<LoggedInUser> {
  const { csrfToken, csrfCookie } = await getCsrfData();
  const res = await request(app)
    .post(`/api/v1/auth/${portal}/login`)
    .set('Cookie', csrfCookie)
    .set('x-csrf-token', csrfToken)
    .set('User-Agent', userAgent)
    .send({ email, password: TEST_PASSWORD });
  const accessCookie = cookieOf(res, 'accessToken');
  return {
    userId: '',
    token: accessCookie.split('=')[1]!,
    accessCookie,
    refreshCookie: cookieOf(res, 'refreshToken'),
    csrfToken,
    csrfCookie,
  };
}

describe('Sessions and refresh', () => {
  let user: LoggedInUser;

  beforeEach(async () => {
    await seedRbac(prisma);
    user = await loginWithRole('student', 'sessions@example.com');
  });

  describe('POST /auth/refresh', () => {
    it('rotates the tokens, matches the contract and keeps the session deadline', async () => {
      const before = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.userId } });
      const res = await refresh(user.refreshCookie, user);

      expect(res.status).toBe(200);
      expectContractResponse(res, 'post', '/auth/refresh');
      expect(new Date(res.body.data.sessionExpiresAt).getTime()).toBe(before.expiresAt.getTime());
      expect(cookieOf(res, 'refreshToken')).not.toBe(user.refreshCookie);

      const rows = await prisma.refreshToken.findMany({ where: { userId: user.userId } });
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.familyId)).size).toBe(1);
      expect(rows.every((r) => r.portal === 'student')).toBe(true);
      expect(rows.every((r) => r.expiresAt.getTime() === before.expiresAt.getTime())).toBe(true);
    });

    it('rejects a refresh token sent in the body with 422', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', user.csrfCookie)
        .set('x-csrf-token', user.csrfToken)
        .send({ refreshToken: user.refreshCookie.split('=')[1] });
      expect(res.status).toBe(422);
    });

    it('rejects a missing refresh cookie with 401', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', user.csrfCookie)
        .set('x-csrf-token', user.csrfToken);
      expect(res.status).toBe(401);
    });

    it('detects reuse of a rotated token and revokes the whole session', async () => {
      const first = await refresh(user.refreshCookie, user);
      const newRefresh = cookieOf(first, 'refreshToken');

      const replay = await refresh(user.refreshCookie, user);
      expect(replay.status).toBe(401);

      // The revocation is committed, so even the newest token no longer works
      expect((await refresh(newRefresh, user)).status).toBe(401);
      const rows = await prisma.refreshToken.findMany({ where: { userId: user.userId } });
      expect(rows.every((r) => r.revokedAt !== null)).toBe(true);

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'session.reuse_detected' },
      });
      expect(entry?.actorId).toBe(user.userId);
    });

    it('rejects refresh after the session deadline', async () => {
      await prisma.refreshToken.updateMany({
        where: { userId: user.userId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await refresh(user.refreshCookie, user)).status).toBe(401);
    });

    it('rejects refresh once the user loses the portal role or is deactivated', async () => {
      await prisma.userRole.deleteMany({ where: { userId: user.userId } });
      expect((await refresh(user.refreshCookie, user)).status).toBe(401);

      const admin = await loginWithRole('admin', 'sessions-admin@example.com');
      await prisma.user.update({ where: { id: admin.userId }, data: { isActive: false } });
      expect((await refresh(admin.refreshCookie, admin)).status).toBe(401);
    });
  });

  describe('GET /auth/sessions', () => {
    it('replaces the earlier session of the same browser but keeps other devices', async () => {
      const sameBrowser = await secondLogin('sessions@example.com', 'student', 'Vitest');
      const otherDevice = await secondLogin('sessions@example.com', 'student', 'Other Phone/2.0');
      const again = await secondLogin('sessions@example.com', 'student', 'Vitest');

      const list = await request(app).get('/api/v1/auth/sessions').set(bearer(again));
      expect(list.status).toBe(200);
      // the beforeEach login, the other phone and the latest browser sign-in
      expect(list.body.data).toHaveLength(3);
      expect(list.body.data.filter((s: { isCurrent: boolean }) => s.isCurrent)).toHaveLength(1);

      // The replaced session no longer works, the other device still does
      expect((await request(app).get('/api/v1/auth/me').set(bearer(sameBrowser))).status).toBe(401);
      expect((await request(app).get('/api/v1/auth/me').set(bearer(otherDevice))).status).toBe(200);
    });

    it('lists live sessions with a stable id across rotation and marks the current one', async () => {
      const other = await secondLogin('sessions@example.com', 'student');

      const list = await request(app).get('/api/v1/auth/sessions').set(bearer(user));
      expect(list.status).toBe(200);
      expectContractResponse(list, 'get', '/auth/sessions');
      expect(list.body.data).toHaveLength(2);
      expect(list.body.meta.total).toBe(2);
      expect(list.body.data.filter((s: { isCurrent: boolean }) => s.isCurrent)).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toContain('ipAddress');

      const currentId = list.body.data.find((s: { isCurrent: boolean }) => s.isCurrent).jti;
      await refresh(other.refreshCookie, other);
      const again = await request(app).get('/api/v1/auth/sessions').set(bearer(user));
      expect(again.body.data.map((s: { jti: string }) => s.jti).sort()).toEqual(
        list.body.data.map((s: { jti: string }) => s.jti).sort()
      );
      expect(again.body.data.find((s: { isCurrent: boolean }) => s.isCurrent).jti).toBe(currentId);
    });

    it('paginates and validates the query', async () => {
      await secondLogin('sessions@example.com', 'student');
      const page = await request(app).get('/api/v1/auth/sessions?limit=1&page=2').set(bearer(user));
      expect(page.status).toBe(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 });

      expect(
        (await request(app).get('/api/v1/auth/sessions?page=0').set(bearer(user))).status
      ).toBe(422);
    });
  });

  describe('revoking sessions', () => {
    it('revokes another session at once and audits it', async () => {
      const other = await secondLogin('sessions@example.com', 'student');
      const list = await request(app).get('/api/v1/auth/sessions').set(bearer(user));
      const otherId = list.body.data.find((s: { isCurrent: boolean }) => !s.isCurrent).jti;

      const res = await request(app)
        .delete(`/api/v1/auth/sessions/${otherId}`)
        .set(bearer(user))
        .set('Cookie', user.csrfCookie)
        .set('x-csrf-token', user.csrfToken);
      expect(res.status).toBe(200);

      // Its access token stops working immediately, and its refresh token too
      expect((await request(app).get('/api/v1/auth/me').set(bearer(other))).status).toBe(401);
      expect((await refresh(other.refreshCookie, other)).status).toBe(401);
      // The caller's session is untouched
      expect((await request(app).get('/api/v1/auth/me').set(bearer(user))).status).toBe(200);

      const entry = await prisma.auditLog.findFirst({ where: { action: 'session.revoked' } });
      expect(entry?.resourceId).toBe(otherId);
    });

    it('clears the cookies when the current session is revoked', async () => {
      const list = await request(app).get('/api/v1/auth/sessions').set(bearer(user));
      const res = await request(app)
        .delete(`/api/v1/auth/sessions/${list.body.data[0].jti}`)
        .set(bearer(user))
        .set('Cookie', user.csrfCookie)
        .set('x-csrf-token', user.csrfToken);
      expect(res.status).toBe(200);
      expect((res.headers['set-cookie'] as unknown as string[]).join(';')).toContain(
        'accessToken=;'
      );
      expect((await request(app).get('/api/v1/auth/me').set(bearer(user))).status).toBe(401);
    });

    it("returns 404 for another user's session and 422 for a malformed id", async () => {
      const stranger = await loginWithRole('student', 'stranger@example.com');
      const strangerList = await request(app).get('/api/v1/auth/sessions').set(bearer(stranger));
      const strangerId = strangerList.body.data[0].jti;

      const del = (id: string) =>
        request(app)
          .delete(`/api/v1/auth/sessions/${id}`)
          .set(bearer(user))
          .set('Cookie', user.csrfCookie)
          .set('x-csrf-token', user.csrfToken);
      expect((await del(strangerId)).status).toBe(404);
      expect((await del('not-a-uuid')).status).toBe(422);
      // The stranger's session is still alive
      expect((await request(app).get('/api/v1/auth/me').set(bearer(stranger))).status).toBe(200);
    });

    it('revokes every other session and keeps the current one', async () => {
      const a = await secondLogin('sessions@example.com', 'student');
      const b = await secondLogin('sessions@example.com', 'student');

      const res = await request(app)
        .delete('/api/v1/auth/sessions')
        .set(bearer(user))
        .set('Cookie', user.csrfCookie)
        .set('x-csrf-token', user.csrfToken);
      expect(res.status).toBe(200);
      expectContractResponse(res, 'delete', '/auth/sessions');

      expect((await request(app).get('/api/v1/auth/me').set(bearer(a))).status).toBe(401);
      expect((await request(app).get('/api/v1/auth/me').set(bearer(b))).status).toBe(401);
      expect((await request(app).get('/api/v1/auth/me').set(bearer(user))).status).toBe(200);
      const list = await request(app).get('/api/v1/auth/sessions').set(bearer(user));
      expect(list.body.data).toHaveLength(1);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the contract user with portal role names', async () => {
      const res = await request(app).get('/api/v1/auth/me').set(bearer(user));
      expect(res.status).toBe(200);
      expectContractResponse(res, 'get', '/auth/me');
      expect(res.body.data).toMatchObject({
        email: 'sessions@example.com',
        emailVerified: true,
        mobileNumber: null,
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });
});
