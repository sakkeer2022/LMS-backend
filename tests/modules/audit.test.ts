import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { signIn } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';
import { logAction } from '@modules/audit/audit.service.js';

describe('Audit Logs API', () => {
  let adminToken: string;

  beforeEach(async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();

    // 1. Create a super_admin role
    const adminRole = await prisma.role.create({
      data: {
        name: 'super_admin',
        description: 'Super Admin',
        isSystem: true,
      },
    });

    const wildCardPerm = await prisma.permission.create({
      data: {
        name: '*',
        resource: 'all',
        action: 'manage',
        description: 'Global access',
      },
    });

    await prisma.rolePermission.create({
      data: {
        roleId: adminRole.id,
        permissionId: wildCardPerm.id,
      },
    });

    // 2. Register an admin user (this action generates an audit log)
    await request(app)
      .post('/api/v1/auth/register')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .send({
        email: 'audit_admin@example.com',
        password: 'Password123!',
        fullName: 'Audit Admin',
      });

    const user = await prisma.user.findFirst({ where: { email: 'audit_admin@example.com' } });

    // 3. Assign the super_admin role
    await prisma.userRole.create({
      data: {
        userId: user!.id,
        roleId: adminRole.id,
      },
    });

    // 4. Re-login (this generates another audit log)
    const loginRes = await signIn({
      email: 'audit_admin@example.com',
      password: 'Password123!',
    });

    const adminAccessTokenCookie = (loginRes.headers['set-cookie'] as unknown as string[])?.find(
      (c: string) => c.startsWith('accessToken=')
    );
    adminToken = adminAccessTokenCookie ? adminAccessTokenCookie.split(';')[0].split('=')[1] : '';
  });

  it('should get a list of audit logs', async () => {
    const res = await request(app)
      .get('/api/v1/audit?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);

    // We expect at least one log because the beforeEach hooks ran
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);

    // The data should contain valid audit log structure
    const log = res.body.data[0];
    expect(log).toHaveProperty('id');
    expect(log).toHaveProperty('action');
    expect(log).toHaveProperty('entity');
    expect(log).toHaveProperty('createdAt');
  });

  it('should filter audit logs by action', async () => {
    const res = await request(app)
      .get('/api/v1/audit?action=create')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);

    if (res.body.data.length > 0) {
      expect(res.body.data[0].action).toBe('create');
    }
  });

  it('should filter audit logs by resource', async () => {
    const res = await request(app)
      .get('/api/v1/audit?entity=auth')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);

    if (res.body.data.length > 0) {
      expect(res.body.data[0].entity).toBe('auth');
    }
  });

  it('returns only the contract fields, without IP, user agent, fingerprint, hashes or users', async () => {
    const res = await request(app)
      .get('/api/v1/audit?limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const allowed = [
      'id',
      'actorId',
      'action',
      'entity',
      'resourceId',
      'severity',
      'traceId',
      'createdAt',
      'changes',
    ];
    for (const event of res.body.data) {
      expect(Object.keys(event).every((key) => allowed.includes(key))).toBe(true);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/audit_admin@example\.com|127\.0\.0\.1|vitest/);
  });

  it('filters by actor, action, entity and resource id', async () => {
    const actor = await prisma.user.findFirstOrThrow({
      where: { email: 'audit_admin@example.com' },
    });
    await logAction({ actorId: actor.id, entity: 'probe', action: 'probe.run', resourceId: 'r-1' });
    const seed = await prisma.auditLog.findFirstOrThrow({ where: { action: 'probe.run' } });
    const params = new URLSearchParams({
      actorId: seed.actorId!,
      action: seed.action,
      entity: seed.entity,
      resourceId: 'r-1',
    });
    const res = await request(app)
      .get(`/api/v1/audit?${params}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const event of res.body.data) {
      expect(event).toMatchObject({
        actorId: seed.actorId,
        action: seed.action,
        entity: seed.entity,
      });
    }
  });

  it('applies the from/to window: from inclusive, to exclusive', async () => {
    const row = await prisma.auditLog.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    const at = row.createdAt;
    const get = (qs: string) =>
      request(app).get(`/api/v1/audit?${qs}`).set('Authorization', `Bearer ${adminToken}`);
    const ids = (res: request.Response) => res.body.data.map((e: { id: string }) => e.id);

    const inclusive = await get(
      `from=${at.toISOString()}&to=${new Date(at.getTime() + 1).toISOString()}`
    );
    expect(ids(inclusive)).toContain(row.id);
    const exclusive = await get(
      `from=${new Date(at.getTime() - 1000).toISOString()}&to=${at.toISOString()}`
    );
    expect(ids(exclusive)).not.toContain(row.id);
  });

  it.each([
    ['from after to', 'from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z'],
    ['a window over 31 days', 'from=2026-09-01T00:00:00Z&to=2026-11-01T00:00:00Z'],
    ['a malformed date', 'from=yesterday'],
    ['a bad actorId', 'actorId=nope'],
    ['an unknown parameter', 'userId=8c121988-8afa-4fb7-b6eb-9b0dcb94f730'],
    ['a limit above 100', 'limit=101'],
  ])('rejects %s with 422', async (_label, qs) => {
    const res = await request(app)
      .get(`/api/v1/audit?${qs}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(422);
  });

  it('records the read itself, with the query but not the response', async () => {
    await request(app)
      .get('/api/v1/audit?action=login.success')
      .set('Authorization', `Bearer ${adminToken}`);
    await vi.waitFor(async () => {
      const read = await prisma.auditLog.findFirst({ where: { entity: 'audit', action: 'read' } });
      expect(read).not.toBeNull();
      expect(Object.keys(read!.newValue as object).sort()).toEqual(['method', 'statusCode', 'url']);
    });
  });

  it('has no detail route', async () => {
    const row = await prisma.auditLog.findFirstOrThrow();
    const res = await request(app)
      .get(`/api/v1/audit/${row.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('should prevent non-admins from viewing audit logs', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    // 1. Create a normal user
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .send({
        email: 'normal@example.com',
        password: 'Password123!',
        fullName: 'Normal User',
      });
    const userAccessTokenCookie = (res.headers['set-cookie'] as unknown as string[])?.find(
      (c: string) => c.startsWith('accessToken=')
    );
    const userToken = userAccessTokenCookie
      ? userAccessTokenCookie.split(';')[0].split('=')[1]
      : '';

    // 2. Try to fetch audit logs
    const failRes = await request(app)
      .get('/api/v1/audit')
      .set('Authorization', `Bearer ${userToken}`);

    expect(failRes.status).toBe(403);
  });
});
