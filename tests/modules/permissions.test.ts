import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { prisma } from '@infrastructure/database/index.js';

describe('Permissions API', () => {
  let superAdminToken: string;

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

    // 2. Register a user
    await request(app)
      .post('/api/v1/auth/register')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .send({
        email: 'super@example.com',
        password: 'Password123!',
        firstName: 'Super',
        lastName: 'Admin',
      });

    const user = await prisma.user.findFirst({ where: { email: 'super@example.com' } });

    // 3. Assign the super_admin role
    await prisma.userRole.create({
      data: {
        userId: user!.id,
        roleId: adminRole.id,
      },
    });

    // 4. Re-login
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .send({
        email: 'super@example.com',
        password: 'Password123!',
      });

    const accessTokenCookie = (loginRes.headers['set-cookie'] as unknown as string[])?.find(
      (c: string) => c.startsWith('accessToken=')
    );
    superAdminToken = accessTokenCookie ? accessTokenCookie.split(';')[0].split('=')[1] : '';
  });

  it('should create a new permission', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const res = await request(app)
      .post('/api/v1/permissions')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'users:read',
        resource: 'users',
        action: 'read',
        description: 'Read users',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('users:read');
  });

  it('should fail to create permission if missing fields', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const res = await request(app)
      .post('/api/v1/permissions')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'users:read',
        // missing resource and action
      });

    expect(res.status).toBe(422); // Validation error
  });

  it('should list permissions with pagination', async () => {
    const res = await request(app)
      .get('/api/v1/permissions?page=1&limit=10')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.meta.total).toBeDefined();
  });

  it('should update a permission description', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const createRes = await request(app)
      .post('/api/v1/permissions')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'users:write',
        resource: 'users',
        action: 'update',
        description: 'Old description',
      });

    const permId = createRes.body.data.id;

    const res = await request(app)
      .patch(`/api/v1/permissions/${permId}`)
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ description: 'New description' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('New description');
  });

  it('should delete a permission', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const createRes = await request(app)
      .post('/api/v1/permissions')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'temp:delete',
        resource: 'temp',
        action: 'delete',
        description: 'Temp',
      });

    const permId = createRes.body.data.id;

    const deleteRes = await request(app)
      .delete(`/api/v1/permissions/${permId}`)
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(deleteRes.status).toBe(200);

    const getRes = await request(app)
      .get(`/api/v1/permissions/${permId}`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(getRes.status).toBe(404);
  });
});
