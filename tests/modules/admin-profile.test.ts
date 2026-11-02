import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { expectContractResponse } from '../helpers/contract.js';
import { loginWithRole, type LoggedInUser } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';

const valid = { fullName: 'Priya Nair', mobileNumber: '+919876543210', timezone: 'Asia/Kolkata' };

function update(user: LoggedInUser, body: object = valid) {
  return request(app)
    .put('/api/v1/admin/me/profile')
    .set('Authorization', `Bearer ${user.token}`)
    .set('Cookie', user.csrfCookie)
    .set('x-csrf-token', user.csrfToken)
    .send(body);
}

const activity = (user: LoggedInUser, query = '') =>
  request(app)
    .get(`/api/v1/admin/me/activity${query}`)
    .set('Authorization', `Bearer ${user.token}`);

describe('Admin profile', () => {
  let admin: LoggedInUser;

  beforeEach(async () => {
    await seedRbac(prisma);
    admin = await loginWithRole('admin', 'profile-admin@example.com');
  });

  describe('PUT /admin/me/profile', () => {
    it('updates the three fields, matches the contract and audits the change', async () => {
      const res = await update(admin);

      expect(res.status).toBe(200);
      expectContractResponse(res, 'put', '/admin/me/profile');
      expect(res.body.data).toMatchObject({ ...valid, email: 'profile-admin@example.com' });

      const row = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
      expect(row.fullName).toBe('Priya Nair');
      expect(row.timezone).toBe('Asia/Kolkata');

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { actorId: admin.userId, action: 'profile.updated' },
      });
      expect(audit.entity).toBe('profile');
      expect(JSON.stringify(audit.newValue)).toContain('Priya Nair');
    });

    it('accepts a null mobile number and time zone, for the UAE as well as India', async () => {
      const uae = await update(admin, {
        fullName: 'Omar Khan',
        mobileNumber: '+971501234567',
        timezone: 'Asia/Dubai',
      });
      expect(uae.status).toBe(200);

      const cleared = await update(admin, {
        fullName: 'Omar Khan',
        mobileNumber: null,
        timezone: null,
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.mobileNumber).toBeNull();
      expect(cleared.body.data.timezone).toBeNull();
    });

    it.each([
      ['blank name', { ...valid, fullName: '   ' }],
      ['bad mobile number', { ...valid, mobileNumber: '98765' }],
      ['unknown time zone', { ...valid, timezone: 'Mars/Base' }],
      ['an email change', { ...valid, email: 'other@example.com' }],
      ['a missing field', { fullName: 'Priya Nair' }],
    ])('rejects %s with 422', async (_name, body) => {
      const res = await update(admin, body);
      expect(res.status).toBe(422);
      expectContractResponse(res, 'put', '/admin/me/profile');
    });

    it('rejects a request with no session (401), a student (403) and a missing CSRF token (403)', async () => {
      const csrf = admin;
      const anonymous = await request(app)
        .put('/api/v1/admin/me/profile')
        .set('Cookie', csrf.csrfCookie)
        .set('x-csrf-token', csrf.csrfToken)
        .send(valid);
      expect(anonymous.status).toBe(401);

      const student = await loginWithRole('student', 'profile-student@example.com');
      expect((await update(student)).status).toBe(403);

      const noCsrf = await request(app)
        .put('/api/v1/admin/me/profile')
        .set('Authorization', `Bearer ${admin.token}`)
        .send(valid);
      expect(noCsrf.status).toBe(403);
    });

    it('never changes another account, whatever the body says', async () => {
      const other = await loginWithRole('admin', 'other-admin@example.com');
      await update(admin, { ...valid, id: other.userId }).then((res) =>
        expect(res.status).toBe(422)
      );
      const row = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
      expect(row.fullName).not.toBe('Priya Nair');
    });
  });

  describe('GET /admin/me/activity', () => {
    it('lists only the caller’s own security events, newest first, and matches the contract', async () => {
      await update(admin);
      const other = await loginWithRole('admin', 'other-admin2@example.com');
      await update(other, { ...valid, fullName: 'Someone Else' });

      const res = await activity(admin);
      expect(res.status).toBe(200);
      expectContractResponse(res, 'get', '/admin/me/activity');

      const actions = res.body.data.map((e: { action: string }) => e.action);
      expect(actions).toContain('login.success');
      expect(actions[0]).toBe('profile.updated');
      expect(actions.every((a: string) => /^(login|session|reauth|profile)\./.test(a))).toBe(true);
      // Someone else's profile edit is not here: only one profile.updated entry exists for admin
      expect(actions.filter((a: string) => a === 'profile.updated')).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toContain('Someone Else');
    });

    it('paginates and rejects a bad limit with 422', async () => {
      await update(admin);
      await update(admin);
      const page = await activity(admin, '?limit=1&page=2');
      expect(page.status).toBe(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta.total).toBeGreaterThanOrEqual(3);

      expect((await activity(admin, '?limit=0')).status).toBe(422);
    });

    it('rejects no session (401) and a student (403)', async () => {
      expect((await request(app).get('/api/v1/admin/me/activity')).status).toBe(401);
      const student = await loginWithRole('student', 'activity-student@example.com');
      expect((await activity(student)).status).toBe(403);
    });
  });
});
