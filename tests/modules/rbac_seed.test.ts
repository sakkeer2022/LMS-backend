import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';
import { PERMISSIONS, SYSTEM_ROLES } from '../../src/core/security/rbac.js';

const PASSWORD = 'Password123!';

/** Registers a user, gives them one seeded role and returns a fresh access token. */
async function tokenForRole(roleName: string, email: string): Promise<string> {
  const { csrfToken, csrfCookie } = await getCsrfData();
  await request(app)
    .post('/api/v1/auth/register')
    .set('Cookie', csrfCookie)
    .set('x-csrf-token', csrfToken)
    .send({ email, password: PASSWORD, fullName: `${roleName} user` });

  const user = await prisma.user.findFirstOrThrow({ where: { email } });
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .set('Cookie', csrfCookie)
    .set('x-csrf-token', csrfToken)
    .send({ email, password: PASSWORD });

  const cookie = (loginRes.headers['set-cookie'] as unknown as string[]).find((c) =>
    c.startsWith('accessToken=')
  );
  return cookie!.split(';')[0]!.split('=')[1]!;
}

// One read route per guarded module
const ADMIN_ROUTES = [
  '/api/v1/users',
  '/api/v1/roles',
  '/api/v1/permissions',
  '/api/v1/audit',
  '/api/v1/admin/stats',
  '/api/v1/notifications',
];

describe('Seeded RBAC roles', () => {
  beforeEach(async () => {
    await seedRbac(prisma);
  });

  it('seeds every catalogued permission and the system roles', async () => {
    const permissions = await prisma.permission.findMany({ select: { name: true } });
    const names = permissions.map((p) => p.name);
    for (const def of PERMISSIONS) expect(names).toContain(def.name);

    const roles = await prisma.role.findMany({ select: { name: true, isSystem: true } });
    for (const def of SYSTEM_ROLES) {
      expect(roles).toContainEqual({ name: def.name, isSystem: true });
    }
  });

  it('is idempotent', async () => {
    const before = await prisma.rolePermission.count();
    await seedRbac(prisma);
    expect(await prisma.rolePermission.count()).toBe(before);
  });

  it('lets a seeded admin through every admin route guard', async () => {
    const token = await tokenForRole('admin', 'seeded-admin@example.com');
    for (const route of ADMIN_ROUTES) {
      const res = await request(app).get(route).set('Authorization', `Bearer ${token}`);
      expect({ route, status: res.status }).toEqual({ route, status: 200 });
    }
  });

  it('keeps feature flags for super_admin only', async () => {
    const adminToken = await tokenForRole('admin', 'flags-admin@example.com');
    const superToken = await tokenForRole('super_admin', 'flags-super@example.com');

    const asAdmin = await request(app)
      .get('/api/v1/feature-flags')
      .set('Authorization', `Bearer ${adminToken}`);
    const asSuper = await request(app)
      .get('/api/v1/feature-flags')
      .set('Authorization', `Bearer ${superToken}`);

    expect(asAdmin.status).toBe(403);
    expect(asSuper.status).toBe(200);
  });

  it.each(['student', 'faculty'])('denies a %s every admin route', async (roleName) => {
    const token = await tokenForRole(roleName, `${roleName}-portal@example.com`);
    for (const route of ADMIN_ROUTES) {
      const res = await request(app).get(route).set('Authorization', `Bearer ${token}`);
      expect({ route, status: res.status }).toEqual({ route, status: 403 });
    }
  });

  it('audits role changes with the actor and the before and after roles', async () => {
    const adminToken = await tokenForRole('admin', 'role-changer@example.com');
    const actor = await prisma.user.findFirstOrThrow({
      where: { email: 'role-changer@example.com' },
    });
    await tokenForRole('student', 'role-target@example.com');
    const target = await prisma.user.findFirstOrThrow({
      where: { email: 'role-target@example.com' },
    });
    const faculty = await prisma.role.findUniqueOrThrow({ where: { name: 'faculty' } });

    const { csrfToken, csrfCookie } = await getCsrfData();
    const res = await request(app)
      .post(`/api/v1/users/${target.id}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken)
      .send({ roleIds: [faculty.id] });
    expect(res.status).toBe(200);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'user.roles_assigned', resourceId: target.id },
    });
    expect(entry).not.toBeNull();
    expect(entry!.actorId).toBe(actor.id);
    expect(entry!.severity).toBe('SECURITY');
    expect(entry!.previousValue).toEqual({ roles: ['student'] });
    expect(entry!.newValue).toEqual({ roles: ['faculty', 'student'] });
  });
});
