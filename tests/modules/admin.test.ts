import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { signIn, registerTestUser } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';

describe('Admin Portal API', () => {
  let superAdminToken: string;
  let regularUserToken: string;
  let targetUserId: string;

  beforeEach(async () => {
    // 1. Create permissions
    const globalAdminPerm = await prisma.permission.create({
      data: {
        name: 'admin.*',
        resource: 'admin',
        action: 'manage',
        description: 'Global Admin Permission',
      },
    });

    const userReadPerm = await prisma.permission.create({
      data: {
        name: 'user.read',
        resource: 'user',
        action: 'read',
        description: 'Read users',
      },
    });

    // 2. Create roles
    const adminRole = await prisma.role.create({
      data: {
        name: 'super_admin',
        description: 'Super Admin Role',
        isSystem: true,
      },
    });

    const regularRole = await prisma.role.create({
      data: {
        name: 'regular_user',
        description: 'Regular User Role',
        isSystem: false,
      },
    });

    // Link permissions
    await prisma.rolePermission.createMany({
      data: [
        { roleId: adminRole.id, permissionId: globalAdminPerm.id },
        { roleId: regularRole.id, permissionId: userReadPerm.id },
      ],
    });

    // 3. Register super admin user
    await registerTestUser({
      email: 'admin@example.com',
      password: 'Password123!',
      fullName: 'System Admin',
    });

    const superAdminUser = await prisma.user.findFirst({ where: { email: 'admin@example.com' } });
    await prisma.userRole.create({
      data: {
        userId: superAdminUser!.id,
        roleId: adminRole.id,
      },
    });

    // 4. Register regular user
    await registerTestUser({
      email: 'user@example.com',
      password: 'Password123!',
      fullName: 'Regular User',
    });

    const regularUser = await prisma.user.findFirst({ where: { email: 'user@example.com' } });
    await prisma.userRole.create({
      data: {
        userId: regularUser!.id,
        roleId: regularRole.id,
      },
    });

    // 5. Create locked-out target user
    const targetUser = await prisma.user.create({
      data: {
        email: 'locked@example.com',
        passwordHash: 'fake-hash',
        fullName: 'Locked User',
        isActive: true,
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() + 1000 * 60 * 15), // locked out for 15 mins
      },
    });
    targetUserId = targetUser.id;

    // 6. Log in admin to get token
    const adminLoginRes = await signIn({
      email: 'admin@example.com',
      password: 'Password123!',
    });

    const adminCookie = (adminLoginRes.headers['set-cookie'] as string[])?.find((c) =>
      c.startsWith('accessToken=')
    );
    superAdminToken = adminCookie ? adminCookie.split(';')[0].split('=')[1] : '';

    // 7. Log in regular user to get token
    const userLoginRes = await signIn({
      email: 'user@example.com',
      password: 'Password123!',
    });

    const userCookie = (userLoginRes.headers['set-cookie'] as string[])?.find((c) =>
      c.startsWith('accessToken=')
    );
    regularUserToken = userCookie ? userCookie.split(';')[0].split('=')[1] : '';
  });

  describe('GET /api/v1/admin/stats', () => {
    it('should retrieve admin dashboard stats successfully', async () => {
      const res = await request(app)
        .get('/api/v1/admin/stats')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('users');
      expect(res.body.data).toHaveProperty('roles');
      expect(res.body.data).toHaveProperty('featureFlags');
      expect(res.body.data).toHaveProperty('auditLogs');
      expect(res.body.data.users.total).toBeGreaterThan(0);
    });

    it('should deny access to regular users (403)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/stats')
        .set('Authorization', `Bearer ${regularUserToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should deny access to unauthenticated requests (401)', async () => {
      const res = await request(app).get('/api/v1/admin/stats');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/admin/health', () => {
    it('should retrieve system health successfully', async () => {
      const res = await request(app)
        .get('/api/v1/admin/health')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('database');
      expect(res.body.data).toHaveProperty('redis');
      expect(res.body.data.database.status).toBe('UP');
    });

    it('should deny access to regular users (403)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/health')
        .set('Authorization', `Bearer ${regularUserToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/admin/users/:id/unlock', () => {
    it('should successfully unlock a locked user account', async () => {
      const { csrfToken, csrfCookie } = await getCsrfData();

      const res = await request(app)
        .post(`/api/v1/admin/users/${targetUserId}/unlock`)
        .set('Cookie', csrfCookie ?? '')
        .set('x-csrf-token', csrfToken ?? '')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify DB changes
      const updatedUser = await prisma.user.findFirst({ where: { id: targetUserId } });
      expect(updatedUser?.failedLoginAttempts).toBe(0);
      expect(updatedUser?.lockedUntil).toBeNull();
    });

    it('should return 404 for non-existent user ID', async () => {
      const { csrfToken, csrfCookie } = await getCsrfData();
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await request(app)
        .post(`/api/v1/admin/users/${fakeId}/unlock`)
        .set('Cookie', csrfCookie ?? '')
        .set('x-csrf-token', csrfToken ?? '')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should validate parameter format (422/400)', async () => {
      const { csrfToken, csrfCookie } = await getCsrfData();

      const res = await request(app)
        .post('/api/v1/admin/users/invalid-uuid/unlock')
        .set('Cookie', csrfCookie ?? '')
        .set('x-csrf-token', csrfToken ?? '')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(422); // Zod error caught by middleware
      expect(res.body.success).toBe(false);
    });

    it('should require x-csrf-token header for POST state mutation', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/users/${targetUserId}/unlock`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(403); // CSRF failure
    });
  });

  describe('PUT /api/v1/admin/users/:id/active', () => {
    it('should successfully toggle user active status', async () => {
      const { csrfToken, csrfCookie } = await getCsrfData();

      const res = await request(app)
        .put(`/api/v1/admin/users/${targetUserId}/active`)
        .set('Cookie', csrfCookie ?? '')
        .set('x-csrf-token', csrfToken ?? '')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updatedUser = await prisma.user.findFirst({ where: { id: targetUserId } });
      expect(updatedUser?.isActive).toBe(false);
    });

    it('should fail with invalid body types (400)', async () => {
      const { csrfToken, csrfCookie } = await getCsrfData();

      const res = await request(app)
        .put(`/api/v1/admin/users/${targetUserId}/active`)
        .set('Cookie', csrfCookie ?? '')
        .set('x-csrf-token', csrfToken ?? '')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ isActive: 'not-a-boolean' });

      expect(res.status).toBe(422);
    });
  });
});
