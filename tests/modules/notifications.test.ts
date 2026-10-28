import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { prisma } from '@infrastructure/database/index.js';

describe('Notifications API', () => {
  let superAdminToken: string;

  beforeEach(async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();

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

    await request(app)
      .post('/api/v1/auth/register')
      .set('Cookie', csrfCookie ?? '')
      .set('x-csrf-token', csrfToken ?? '')
      .send({
        email: 'super@example.com',
        password: 'Password123!',
        firstName: 'Super',
        lastName: 'Admin',
      });

    const user = await prisma.user.findFirst({ where: { email: 'super@example.com' } });

    await prisma.userRole.create({
      data: {
        userId: user!.id,
        roleId: adminRole.id,
      },
    });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('Cookie', csrfCookie ?? '')
      .set('x-csrf-token', csrfToken ?? '')
      .send({
        email: 'super@example.com',
        password: 'Password123!',
      });

    const accessTokenCookie = (loginRes.headers['set-cookie'] as string[])?.find(
      (c) => c.startsWith('accessToken=')
    );
    superAdminToken = accessTokenCookie ? accessTokenCookie.split(';')[0].split('=')[1] : '';
  });

  it('should list items', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Cookie', csrfCookie ?? '')
      .set('x-csrf-token', csrfToken ?? '')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
