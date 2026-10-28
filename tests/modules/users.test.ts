import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { prisma } from '@infrastructure/database/index.js';

describe('Users API', () => {
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

    // 2. Register a super admin user
    await request(app)
      .post('/api/v1/auth/register')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .send({
        email: 'admin@example.com',
        password: 'Password123!',
        fullName: 'Super Admin',
      });

    const user = await prisma.user.findFirst({ where: { email: 'admin@example.com' } });

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
        email: 'admin@example.com',
        password: 'Password123!',
      });

    const accessTokenCookie = (loginRes.headers['set-cookie'] as unknown as string[])?.find(
      (c: string) => c.startsWith('accessToken=')
    );
    superAdminToken = accessTokenCookie ? accessTokenCookie.split(';')[0].split('=')[1] : '';
  });

  it('should get a list of users with pagination', async () => {
    const res = await request(app)
      .get('/api/v1/users?page=1&limit=10')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('should manually create a user', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const res = await request(app)
      .post('/api/v1/users')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'newuser@example.com',
        password: 'Password123!',
        fullName: 'New User',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('newuser@example.com');
  });

  it('should update a user details', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const createRes = await request(app)
      .post('/api/v1/users')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'update_me@example.com',
        password: 'Password123!',
        fullName: 'Old Name',
      });

    const userId = createRes.body.data.id;

    const res = await request(app)
      .patch(`/api/v1/users/${userId}`)
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ fullName: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('Updated Name');
  });

  it('should assign a role to a user', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const userRes = await request(app)
      .post('/api/v1/users')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'role_test@example.com',
        password: 'Password123!',
        fullName: 'Role Test',
      });
    const userId = userRes.body.data.id;

    const roleRes = await request(app)
      .post('/api/v1/roles')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'manager', description: 'Manager' });
    const roleId = roleRes.body.data.id;

    const assignRes = await request(app)
      .post(`/api/v1/users/${userId}/roles`)
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ roleIds: [roleId] });

    expect(assignRes.status).toBe(200);

    // verify role was assigned
    const getRes = await request(app)
      .get(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    const assignedRoles = getRes.body.data.roles;
    expect(assignedRoles.some((r: any) => r.id === roleId)).toBe(true);
  });

  it('should remove a role from a user', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const userRes = await request(app)
      .post('/api/v1/users')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'role_rm_test@example.com',
        password: 'Password123!',
        fullName: 'Role Test',
      });
    const userId = userRes.body.data.id;

    const roleRes = await request(app)
      .post('/api/v1/roles')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'guest', description: 'Guest' });
    const roleId = roleRes.body.data.id;

    await request(app)
      .post(`/api/v1/users/${userId}/roles`)
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ roleIds: [roleId] });

    const rmRes = await request(app)
      .delete(`/api/v1/users/${userId}/roles`)
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ roleIds: [roleId] });

    expect(rmRes.status).toBe(200);

    const getRes = await request(app)
      .get(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    const assignedRoles = getRes.body.data.roles;
    expect(assignedRoles.some((r: any) => r.id === roleId)).toBe(false);
  });

  it('should disable a user', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const createRes = await request(app)
      .post('/api/v1/users')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'disable_me@example.com',
        password: 'Password123!',
        fullName: 'Disable Me',
      });

    const userId = createRes.body.data.id;

    const res = await request(app)
      .patch(`/api/v1/users/${userId}`)
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });
});
