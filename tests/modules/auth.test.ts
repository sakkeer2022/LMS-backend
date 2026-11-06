import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';
import { loginWithRole, signIn, registerTestUser } from '../helpers/users.js';

/** A student signed in through the portal login (refresh requires a portal session). */
async function portalSession(email: string) {
  await seedRbac(prisma);
  return loginWithRole('student', email);
}

describe('Auth API', () => {
  const registerPayload = {
    email: 'test@example.com',
    password: 'Password123!',
    fullName: 'Test User',
  };

  it('should get current user profile (/me)', async () => {
    const registerRes = await registerTestUser(registerPayload);
    const cookies = (registerRes.headers['set-cookie'] as unknown as string[])
      ?.map((c: string) => c.split(';')[0])
      .join('; ');

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies || ''); // Send cookies

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(registerPayload.email);
  });

  it('should reject access without token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  describe('CSRF Protection', () => {
    it('should reject unsafe method without CSRF token with 403', async () => {
      // POST without x-csrf-token
      const res = await request(app).post('/api/v1/auth/student/login').send({
        email: 'test@example.com',
        password: 'Password123!',
      });
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('CSRF token missing');
    });

    it('should allow safe method (GET) without CSRF token', async () => {
      // GET should pass CSRF, but might fail auth (401), which proves CSRF didn't block it (403)
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('Refresh and Logout', () => {
    it('should successfully refresh token and rotate it', async () => {
      const { refreshCookie, csrfToken, csrfCookie } = await portalSession(
        'refresh_success@example.com'
      );

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${refreshCookie}; ${csrfCookie}`)
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const newCookies = res.headers['set-cookie'];
      expect(newCookies.some((c: string) => c.includes('accessToken='))).toBe(true);
      expect(newCookies.some((c: string) => c.includes('refreshToken='))).toBe(true);

      // Ensure the old refresh token is deleted by trying to use it again
      const failedRes = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${refreshCookie}; ${csrfCookie}`)
        .set('x-csrf-token', csrfToken);
      expect(failedRes.status).toBe(401);
    });

    it('should reject missing refresh token with 401', async () => {
      const { csrfToken, csrfCookie } = await getCsrfData();
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', csrfCookie)
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Refresh token is required');
    });

    it('should clear tokens from db on logout', async () => {
      const { csrfToken, csrfCookie } = await getCsrfData();
      const payload = {
        email: 'logout_test@example.com',
        password: 'Password123!',
        fullName: 'Logout Test',
      };

      const registerRes = await registerTestUser(payload);

      const cookies = registerRes.headers['set-cookie'];
      const refreshCookie = cookies?.find((c: string) => c.startsWith('refreshToken='));

      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', `${refreshCookie}; ${csrfCookie}`)
        .set('x-csrf-token', csrfToken);

      expect(logoutRes.status).toBe(200);

      // Verify old token is invalid
      const failedRes = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${refreshCookie}; ${csrfCookie}`)
        .set('x-csrf-token', csrfToken);
      expect(failedRes.status).toBe(401);
    });

    it('should handle repeated logout safely', async () => {
      const { csrfToken, csrfCookie } = await getCsrfData();
      const payload = {
        email: 'logout_repeat@example.com',
        password: 'Password123!',
        fullName: 'Logout Repeat',
      };

      const registerRes = await registerTestUser(payload);

      const cookies = registerRes.headers['set-cookie'];
      const refreshCookie = cookies?.find((c: string) => c.startsWith('refreshToken='));

      await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', `${refreshCookie}; ${csrfCookie}`)
        .set('x-csrf-token', csrfToken);

      // Repeated logout
      const repeatedRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', `${refreshCookie}; ${csrfCookie}`)
        .set('x-csrf-token', csrfToken);

      expect(repeatedRes.status).toBe(200);
      expect(repeatedRes.body.success).toBe(true);
    });
  });

  describe('Token Claims & Roles', () => {
    it('should reflect new roles only after re-login (stale token behavior)', async () => {
      const payload = {
        email: 'stale_token@example.com',
        password: 'Password123!',
        fullName: 'Stale Token',
      };

      const registerRes = await registerTestUser(payload);

      const cookies = (registerRes.headers['set-cookie'] as unknown as string[])
        ?.map((c: string) => c.split(';')[0])
        .join('; ');
      const accessTokenCookie = (registerRes.headers['set-cookie'] as unknown as string[])?.find(
        (c: string) => c.startsWith('accessToken=')
      );
      const token = accessTokenCookie ? accessTokenCookie.split(';')[0].split('=')[1] : '';

      const rolesRes = await request(app)
        .get('/api/v1/roles')
        .set('Cookie', cookies || '')
        .set('Authorization', `Bearer ${token}`);

      // Normal user cannot list roles
      expect(rolesRes.status).toBe(403);

      // Give user role.read permission via a new role
      const testRole = await prisma.role.create({
        data: { name: 'can_read_roles', description: 'test' },
      });
      const readPerm = await prisma.permission.create({
        data: { name: 'role.read', resource: 'role', action: 'read', description: 'read' },
      });
      await prisma.rolePermission.create({
        data: { roleId: testRole.id, permissionId: readPerm.id },
      });

      const dbUser = await prisma.user.findFirst({ where: { email: payload.email } });
      await prisma.userRole.create({
        data: { userId: dbUser!.id, roleId: testRole.id },
      });

      // The old token is stale (still gets 403)
      const staleRolesRes = await request(app)
        .get('/api/v1/roles')
        .set('Cookie', cookies || '')
        .set('Authorization', `Bearer ${token}`);
      expect(staleRolesRes.status).toBe(403);

      // Re-login
      const loginRes = await signIn({
        email: payload.email,
        password: payload.password,
      });

      const newCookies = (loginRes.headers['set-cookie'] as unknown as string[])
        ?.map((c: string) => c.split(';')[0])
        .join('; ');
      const newAccessTokenCookie = (loginRes.headers['set-cookie'] as unknown as string[])?.find(
        (c: string) => c.startsWith('accessToken=')
      );
      const newToken = newAccessTokenCookie ? newAccessTokenCookie.split(';')[0].split('=')[1] : '';

      const freshRolesRes = await request(app)
        .get('/api/v1/roles')
        .set('Cookie', newCookies || '')
        .set('Authorization', `Bearer ${newToken}`);

      expect(freshRolesRes.status).toBe(200);
    });
  });

  describe('Transactions & Partial Writes', () => {
    it('should rollback old token deletion if new token generation fails during refresh', async () => {
      const { refreshCookie, csrfToken, csrfCookie } =
        await portalSession('refreshtest@example.com');

      // Verify token exists in DB
      const initialTokensCount = await prisma.refreshToken.count();

      // Mock creation failure
      const createSpy = vi
        .spyOn(prisma.refreshToken, 'create')
        .mockRejectedValueOnce(new Error('DB Simulation Error'));

      // Attempt to refresh
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${refreshCookie}; ${csrfCookie}`)
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(500);

      // Verify the old token was NOT deleted due to transaction rollback
      const finalTokensCount = await prisma.refreshToken.count();
      expect(finalTokensCount).toBe(initialTokensCount);

      createSpy.mockRestore();
    });
  });

  describe('Impossible Travel Integration', () => {
    it('blocks session refresh if impossible travel Redis key is set', async () => {
      const { refreshCookie, csrfToken, csrfCookie } = await portalSession(
        'travelblocked@example.com'
      );
      const dbUser = await prisma.user.findFirst({ where: { email: 'travelblocked@example.com' } });
      expect(dbUser).not.toBeNull();

      // Set impossible travel mock suspension for this user
      const { mockImpossibleTravelSuspensions } =
        await import('../../src/modules/auth/auth.service.js');
      mockImpossibleTravelSuspensions.add(dbUser!.id);

      // Try to refresh
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${refreshCookie}; ${csrfCookie}`)
        .set('x-csrf-token', csrfToken);

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Session suspended: unusual login location detected');

      // Cleanup
      mockImpossibleTravelSuspensions.delete(dbUser!.id);
    });
  });
});
