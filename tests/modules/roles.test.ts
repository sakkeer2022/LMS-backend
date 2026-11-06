import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { signIn, registerTestUser } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';

describe('Roles API', () => {
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

    // 2. Register a user
    await registerTestUser({
      email: 'admin@example.com',
      password: 'Password123!',
      fullName: 'Admin User',
    });

    const user = await prisma.user.findFirst({ where: { email: 'admin@example.com' } });

    // 3. Assign the super_admin role
    await prisma.userRole.create({
      data: {
        userId: user!.id,
        roleId: adminRole.id,
      },
    });

    // 4. Re-login to get the updated token with roles in payload
    const loginRes = await signIn({
      email: 'admin@example.com',
      password: 'Password123!',
    });

    const accessTokenCookie = (loginRes.headers['set-cookie'] as unknown as string[])?.find(
      (c: string) => c.startsWith('accessToken=')
    );
    adminToken = accessTokenCookie ? accessTokenCookie.split(';')[0].split('=')[1] : '';
  });

  it('should create a new role', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const res = await request(app)
      .post('/api/v1/roles')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'editor',
        description: 'Content Editor',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('editor');
  });

  it('should fail to create role if not authenticated', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const res = await request(app)
      .post('/api/v1/roles')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .send({
        name: 'editor',
        description: 'Content Editor',
      });

    expect(res.status).toBe(401);
  });

  it('should list roles with pagination', async () => {
    // Already created super_admin in beforeEach
    const res = await request(app)
      .get('/api/v1/roles?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('should get a role by ID', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const createRes = await request(app)
      .post('/api/v1/roles')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'viewer', description: 'Viewer' });

    const roleId = createRes.body.data.id;

    const res = await request(app)
      .get(`/api/v1/roles/${roleId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('viewer');
  });

  it('should update a role', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const createRes = await request(app)
      .post('/api/v1/roles')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'moderator', description: 'Mod' });

    const roleId = createRes.body.data.id;

    const res = await request(app)
      .patch(`/api/v1/roles/${roleId}`)
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'Updated Mod' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Updated Mod');
  });

  it('should delete a role', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const createRes = await request(app)
      .post('/api/v1/roles')
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'temp_role', description: 'Temp' });

    const roleId = createRes.body.data.id;

    const deleteRes = await request(app)
      .delete(`/api/v1/roles/${roleId}`)
      .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
      .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteRes.status).toBe(200);

    // Verify it's actually deleted (or soft-deleted)
    const getRes = await request(app)
      .get(`/api/v1/roles/${roleId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(404);
  });

  describe('RBAC Negative Coverage', () => {
    it('should reject a normal user from creating a role', async () => {
      const { csrfToken, csrfCookie } = await getCsrfData();

      const payload = {
        email: 'normal_user@example.com',
        password: 'Password123!',
        fullName: 'Normal User',
      };

      await registerTestUser(payload);

      const loginRes = await signIn({
        email: payload.email,
        password: payload.password,
      });

      const accessTokenCookie = (loginRes.headers['set-cookie'] as unknown as string[])?.find(
        (c: string) => c.startsWith('accessToken=')
      );
      const normalToken = accessTokenCookie ? accessTokenCookie.split(';')[0].split('=')[1] : '';

      const res = await request(app)
        .post('/api/v1/roles')
        .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
        .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
        .set('Authorization', `Bearer ${normalToken}`)
        .send({
          name: 'hacker_role',
          description: 'Hacked',
        });

      // Normal user does not have roles:manage permission, nor *
      expect(res.status).toBe(403);
    });

    it('should reject regular admin from deleting system roles', async () => {
      const { csrfToken, csrfCookie } = await getCsrfData();

      const payload = {
        email: 'regular_admin@example.com',
        password: 'Password123!',
        fullName: 'Regular Admin',
      };

      await registerTestUser(payload);

      const regAdminRole = await prisma.role.create({
        data: {
          name: 'regular_admin',
          description: 'Admin',
          isSystem: false,
        },
      });

      const rolesPermCreate = await prisma.permission.create({
        data: {
          name: 'role.create',
          resource: 'role',
          action: 'create',
          description: 'Create roles',
        },
      });
      const rolesPermDelete = await prisma.permission.create({
        data: {
          name: 'role.delete',
          resource: 'role',
          action: 'delete',
          description: 'Delete roles',
        },
      });

      await prisma.rolePermission.createMany({
        data: [
          { roleId: regAdminRole.id, permissionId: rolesPermCreate.id },
          { roleId: regAdminRole.id, permissionId: rolesPermDelete.id },
        ],
      });

      const dbUser = await prisma.user.findFirst({ where: { email: payload.email } });
      await prisma.userRole.create({
        data: {
          userId: dbUser!.id,
          roleId: regAdminRole.id,
        },
      });

      const loginRes = await signIn({
        email: payload.email,
        password: payload.password,
      });

      const accessTokenCookie = (loginRes.headers['set-cookie'] as unknown as string[])?.find(
        (c: string) => c.startsWith('accessToken=')
      );
      const regToken = accessTokenCookie ? accessTokenCookie.split(';')[0].split('=')[1] : '';

      const createRes = await request(app)
        .post('/api/v1/roles')
        .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
        .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
        .set('Authorization', `Bearer ${regToken}`)
        .send({ name: 'test_delete_role', description: 'Test' });

      expect(createRes.status).toBe(201);

      const superAdminRole = await prisma.role.findFirst({ where: { name: 'super_admin' } });

      const deleteRes = await request(app)
        .delete(`/api/v1/roles/${superAdminRole?.id}`)
        .set('Cookie', typeof csrfCookie !== 'undefined' ? csrfCookie : '')
        .set('x-csrf-token', typeof csrfToken !== 'undefined' ? csrfToken : '')
        .set('Authorization', `Bearer ${regToken}`);

      expect(deleteRes.status).toBe(403);
      expect(deleteRes.body.message).toContain('Cannot delete a system role');
    });
  });
});
