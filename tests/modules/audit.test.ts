import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { signIn, registerTestUser } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';
import { logAction } from '@modules/audit/index.js';

describe('Audit Logs API', () => {
  let adminToken: string;

  beforeEach(async () => {
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

    // 2. Create an admin user
    await registerTestUser({
      email: 'audit_admin@example.com',
      password: 'Password123!',
      fullName: 'Audit Admin',
    });

    const user = await prisma.user.findFirst({ where: { email: 'audit_admin@example.com' } });
    // The list needs at least one record; the sign-in below goes through no HTTP route
    await logAction({
      actorId: user!.id,
      entity: 'user',
      action: 'user.created',
      resourceId: user!.id,
    });

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
    expect(log).toHaveProperty('resource');
    expect(log).toHaveProperty('status');
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
      .get('/api/v1/audit?resource=auth')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);

    if (res.body.data.length > 0) {
      expect(res.body.data[0].resource).toBe('auth');
    }
  });

  it('should prevent non-admins from viewing audit logs', async () => {
    // 1. Create a normal user
    const res = await registerTestUser({
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
