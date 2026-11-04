import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { loginWithRole, type LoggedInUser } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';

type Method = 'post' | 'put' | 'patch' | 'delete';

function call(user: LoggedInUser, method: Method, path: string, body: object) {
  return request(app)
    [method](`/api/v1${path}`)
    .set('Authorization', `Bearer ${user.token}`)
    .set('Cookie', user.csrfCookie)
    .set('x-csrf-token', user.csrfToken)
    .send(body);
}

const roleId = async (name: string) =>
  (await prisma.role.findUniqueOrThrow({ where: { name } })).id;

describe('System role grants (LMS-104)', () => {
  let admin: LoggedInUser;
  let superAdmin: LoggedInUser;
  let target: string;

  beforeEach(async () => {
    await seedRbac(prisma);
    admin = await loginWithRole('admin', 'admin@example.org');
    superAdmin = await loginWithRole('super_admin', 'root@example.org');
    target = (
      await prisma.user.create({
        data: { email: 'target@example.org', passwordHash: 'x', fullName: 'Target' },
      })
    ).id;
  });

  it('stops an admin granting admin or super_admin, and audits the attempt', async () => {
    for (const name of ['super_admin', 'admin']) {
      const roleIds = [await roleId(name)];
      expect((await call(admin, 'post', `/users/${admin.userId}/roles`, { roleIds })).status).toBe(
        403
      );
      expect((await call(admin, 'put', `/users/${target}/roles`, { roleIds })).status).toBe(403);
    }
    expect(await prisma.userRole.count({ where: { userId: target } })).toBe(0);
    const denied = await prisma.auditLog.findFirst({
      where: { action: 'user.roles_changed_denied', actorId: admin.userId },
    });
    expect(denied?.severity).toBe('SECURITY');
  });

  it('lets an admin assign student and faculty', async () => {
    const roleIds = [await roleId('student'), await roleId('faculty')];
    expect((await call(admin, 'post', `/users/${target}/roles`, { roleIds })).status).toBe(200);
    expect((await call(admin, 'delete', `/users/${target}/roles`, { roleIds })).status).toBe(200);
  });

  it('stops an admin removing an admin role, but allows changes that leave it alone', async () => {
    const adminRole = await roleId('admin');
    const studentRole = await roleId('student');
    await prisma.userRole.create({ data: { userId: target, roleId: adminRole } });
    expect(
      (await call(admin, 'delete', `/users/${target}/roles`, { roleIds: [adminRole] })).status
    ).toBe(403);
    expect(
      (await call(admin, 'put', `/users/${target}/roles`, { roleIds: [studentRole] })).status
    ).toBe(403);
    expect(
      (await call(admin, 'put', `/users/${target}/roles`, { roleIds: [adminRole, studentRole] }))
        .status
    ).toBe(200);
  });

  it('stops an admin changing a system role, its permissions or an admin parent', async () => {
    const student = await roleId('student');
    const permissionIds = [(await prisma.permission.findFirstOrThrow()).id];
    expect(
      (await call(admin, 'post', `/roles/${student}/permissions`, { permissionIds })).status
    ).toBe(403);
    expect(
      (await call(admin, 'put', `/roles/${student}/permissions`, { permissionIds })).status
    ).toBe(403);
    expect(
      (await call(admin, 'delete', `/roles/${student}/permissions`, { permissionIds })).status
    ).toBe(403);
    expect((await call(admin, 'patch', `/roles/${student}`, { isActive: false })).status).toBe(403);
    expect(
      (
        await call(admin, 'post', '/roles', {
          name: 'sneaky',
          parentId: await roleId('super_admin'),
        })
      ).status
    ).toBe(403);
    expect(await prisma.rolePermission.count({ where: { roleId: student } })).toBe(0);
  });

  it('still lets an admin manage custom roles', async () => {
    const created = await call(admin, 'post', '/roles', { name: 'tutor_lead' });
    expect(created.status).toBe(201);
    const permissionIds = [(await prisma.permission.findFirstOrThrow()).id];
    expect(
      (await call(admin, 'post', `/roles/${created.body.data.id}/permissions`, { permissionIds }))
        .status
    ).toBe(200);
  });

  it('stops an admin handing out a permission it does not hold', async () => {
    const flags = await prisma.permission.findFirstOrThrow({
      where: { resource: 'feature_flags' },
    });
    const held = await prisma.permission.findFirstOrThrow({ where: { resource: 'user' } });
    const custom = await prisma.role.create({ data: { name: 'flag_keeper' } });
    const withFlags = await prisma.role.create({ data: { name: 'flag_holder' } });
    await prisma.rolePermission.create({ data: { roleId: withFlags.id, permissionId: flags.id } });

    const grant = (permissionId: string) => ({ permissionIds: [permissionId] });
    expect(
      (await call(admin, 'post', `/roles/${custom.id}/permissions`, grant(flags.id))).status
    ).toBe(403);
    expect(
      (await call(admin, 'put', `/roles/${custom.id}/permissions`, grant(flags.id))).status
    ).toBe(403);
    expect(
      (await call(admin, 'post', `/users/${target}/roles`, { roleIds: [withFlags.id] })).status
    ).toBe(403);
    expect(
      (await call(admin, 'put', `/users/${target}/roles`, { roleIds: [withFlags.id] })).status
    ).toBe(403);
    expect(
      (await call(admin, 'post', '/roles', { name: 'child', parentId: withFlags.id })).status
    ).toBe(403);
    expect(
      (await call(admin, 'patch', `/roles/${custom.id}`, { parentId: withFlags.id })).status
    ).toBe(403);
    expect(await prisma.rolePermission.count({ where: { roleId: custom.id } })).toBe(0);

    expect(
      (await call(admin, 'post', `/roles/${custom.id}/permissions`, grant(held.id))).status
    ).toBe(200);
    expect(
      (await call(superAdmin, 'post', `/users/${target}/roles`, { roleIds: [withFlags.id] })).status
    ).toBe(200);
  });

  it('lets super_admin do all of it', async () => {
    const adminRole = await roleId('admin');
    const student = await roleId('student');
    const permissionIds = [(await prisma.permission.findFirstOrThrow()).id];
    expect(
      (await call(superAdmin, 'post', `/users/${target}/roles`, { roleIds: [adminRole] })).status
    ).toBe(200);
    expect(
      (await call(superAdmin, 'delete', `/users/${target}/roles`, { roleIds: [adminRole] })).status
    ).toBe(200);
    expect(
      (await call(superAdmin, 'post', `/roles/${student}/permissions`, { permissionIds })).status
    ).toBe(200);
    expect(
      (await call(superAdmin, 'delete', `/roles/${student}/permissions`, { permissionIds })).status
    ).toBe(200);
  });
});
