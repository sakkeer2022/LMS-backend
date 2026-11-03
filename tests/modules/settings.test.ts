import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { loginWithRole, reauthenticate } from '../helpers/users.js';
import { expectContractResponse } from '../helpers/contract.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';
import { getSetting } from '../../src/modules/settings/index.js';

// The real registry is empty until the PO approves keys; tests use their own.
vi.mock('../../src/modules/settings/settings.registry.js', () => ({
  SETTING_DEFINITIONS: [
    {
      key: 'test.maxDailyBookings',
      type: 'integer',
      description: 'Test integer setting',
      defaultValue: 3,
      minimum: 1,
      maximum: 10,
    },
    {
      key: 'test.mode',
      type: 'string',
      description: 'Test enum setting',
      defaultValue: 'strict',
      allowedValues: ['strict', 'relaxed'],
    },
    {
      key: 'test.enabled',
      type: 'boolean',
      description: 'Test boolean setting',
      defaultValue: false,
    },
  ],
}));

const BASE = '/api/v1/admin/settings';

describe('Platform settings API', () => {
  let adminToken: string;
  let adminId: string;
  let csrf: { csrfToken: string; csrfCookie: string };

  function put(key: string, body: unknown, token = adminToken): request.Test {
    return request(app)
      .put(`${BASE}/${key}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', csrf.csrfCookie)
      .set('x-csrf-token', csrf.csrfToken)
      .send(body as object);
  }

  beforeEach(async () => {
    await seedRbac(prisma);
    const admin = await loginWithRole('admin', 'settings-admin@example.com');
    await reauthenticate(admin);
    ({ token: adminToken, userId: adminId } = admin);
    csrf = await getCsrfData();
  });

  describe('GET /admin/settings', () => {
    it('lists registered settings by key with defaults and revision 1', async () => {
      const res = await request(app).get(BASE).set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.map((s: { key: string }) => s.key)).toEqual([
        'test.enabled',
        'test.maxDailyBookings',
        'test.mode',
      ]);
      expect(res.body.data[1]).toMatchObject({
        type: 'integer',
        value: 3,
        minimum: 1,
        maximum: 10,
        revision: 1,
      });
      expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
      expectContractResponse(res, 'get', '/admin/settings');
    });

    it('paginates', async () => {
      const res = await request(app)
        .get(`${BASE}?page=2&limit=2`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.map((s: { key: string }) => s.key)).toEqual(['test.mode']);
      expect(res.body.meta.totalPages).toBe(2);
    });

    it('rejects an invalid limit with 422', async () => {
      const res = await request(app)
        .get(`${BASE}?limit=500`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
    });

    it('requires authentication', async () => {
      expect((await request(app).get(BASE)).status).toBe(401);
    });

    it('requires configuration.read', async () => {
      const { token } = await loginWithRole('student', 'settings-student@example.com');
      const res = await request(app).get(BASE).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /admin/settings/:key', () => {
    it('returns one setting', async () => {
      const res = await request(app)
        .get(`${BASE}/test.mode`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        key: 'test.mode',
        value: 'strict',
        allowedValues: ['strict', 'relaxed'],
        revision: 1,
      });
      expectContractResponse(res, 'get', '/admin/settings/test.mode');
    });

    it('returns 404 for an unregistered key', async () => {
      const res = await request(app)
        .get(`${BASE}/test.unknown`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expectContractResponse(res, 'get', '/admin/settings/test.unknown');
    });

    it('returns 422 for a malformed key', async () => {
      const res = await request(app)
        .get(`${BASE}/Bad-Key`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
    });
  });

  describe('PUT /admin/settings/:key', () => {
    it('updates the value, bumps the revision and applies immediately', async () => {
      const res = await put('test.maxDailyBookings', {
        value: 5,
        expectedRevision: 1,
        reason: 'Pilot with more sessions',
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ key: 'test.maxDailyBookings', value: 5, revision: 2 });
      expectContractResponse(res, 'put', '/admin/settings/test.maxDailyBookings');
      expect(await getSetting<number>('test.maxDailyBookings')).toBe(5);

      const row = await prisma.systemSetting.findUniqueOrThrow({
        where: { key: 'test.maxDailyBookings' },
      });
      expect(row.updatedBy).toBe(adminId);
    });

    it('audits the change with the actor, old and new values and the reason', async () => {
      await put('test.mode', { value: 'relaxed', expectedRevision: 1, reason: 'Trial week' });

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'setting.updated', resourceId: 'test.mode' },
      });
      expect(entry).not.toBeNull();
      expect(entry!.actorId).toBe(adminId);
      expect(entry!.entity).toBe('system_setting');
      expect(entry!.previousValue).toEqual({ value: 'strict', revision: 1 });
      expect(entry!.newValue).toEqual({ value: 'relaxed', revision: 2, reason: 'Trial week' });
    });

    it('rejects a stale revision with 409 and keeps the value', async () => {
      await put('test.enabled', { value: true, expectedRevision: 1, reason: 'First' });
      const res = await put('test.enabled', { value: false, expectedRevision: 1, reason: 'Late' });

      expect(res.status).toBe(409);
      expectContractResponse(res, 'put', '/admin/settings/test.enabled');
      expect(await getSetting<boolean>('test.enabled')).toBe(true);
    });

    it.each([
      ['wrong type', { value: 'five', expectedRevision: 1, reason: 'x' }],
      ['not an integer', { value: 2.5, expectedRevision: 1, reason: 'x' }],
      ['below minimum', { value: 0, expectedRevision: 1, reason: 'x' }],
      ['above maximum', { value: 11, expectedRevision: 1, reason: 'x' }],
      ['missing reason', { value: 5, expectedRevision: 1 }],
      ['blank reason', { value: 5, expectedRevision: 1, reason: '   ' }],
      ['unknown field', { value: 5, expectedRevision: 1, reason: 'x', type: 'string' }],
    ])('rejects %s with 422', async (_label, body) => {
      const res = await put('test.maxDailyBookings', body);
      expect(res.status).toBe(422);
      expect(await getSetting<number>('test.maxDailyBookings')).toBe(3);
    });

    it('rejects a value outside the allowed list with 422', async () => {
      const res = await put('test.mode', { value: 'loose', expectedRevision: 1, reason: 'x' });
      expect(res.status).toBe(422);
      expectContractResponse(res, 'put', '/admin/settings/test.mode');
    });

    it('returns 404 for an unregistered key', async () => {
      const res = await put('test.unknown', { value: 1, expectedRevision: 1, reason: 'x' });
      expect(res.status).toBe(404);
    });

    it('requires configuration.manage', async () => {
      const readOnly = await prisma.role.create({ data: { name: 'settings_reader' } });
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { name: 'configuration.read' },
      });
      await prisma.rolePermission.create({
        data: { roleId: readOnly.id, permissionId: permission.id },
      });
      const { token } = await loginWithRole('settings_reader', 'settings-reader@example.com');

      const read = await request(app).get(BASE).set('Authorization', `Bearer ${token}`);
      const write = await put(
        'test.mode',
        { value: 'relaxed', expectedRevision: 1, reason: 'x' },
        token
      );

      expect(read.status).toBe(200);
      expect(write.status).toBe(403);
    });

    it('requires recent re-authentication, even for an admin who can manage settings', async () => {
      const stale = await loginWithRole('admin', 'settings-stale@example.com');

      const res = await put(
        'test.mode',
        { value: 'relaxed', expectedRevision: 1, reason: 'x' },
        stale.token
      );
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Recent re-authentication required');

      await reauthenticate(stale);
      const retry = await put(
        'test.mode',
        { value: 'relaxed', expectedRevision: 1, reason: 'x' },
        stale.token
      );
      expect(retry.status).toBe(200);
    });

    it('requires a CSRF token', async () => {
      const res = await request(app)
        .put(`${BASE}/test.mode`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 'relaxed', expectedRevision: 1, reason: 'x' });
      expect(res.status).toBe(403);
    });
  });
});
