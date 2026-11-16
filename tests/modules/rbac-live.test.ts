import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { prisma } from '@infrastructure/database/index.js';
import { signAccessToken } from '@core/security/jwt';
import { config } from '@config/index';
import { InMemoryEmailProvider, setEmailProvider } from '@infrastructure/email/index.js';

// The config is read when the app boots, so the flag is set on it directly
beforeAll(() => {
  config.security.rbacLiveAdmin = true;
});
afterAll(() => {
  config.security.rbacLiveAdmin = false;
});

async function makeUser(roleIds: string[], status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  const user = await prisma.user.create({
    data: {
      email: `u-${randomUUID()}@test.com`,
      passwordHash: 'x',
      fullName: 'T',
      status,
      isActive: status === 'ACTIVE',
      emailVerifiedAt: new Date(),
      roles: { create: roleIds.map((roleId) => ({ roleId })) },
    },
  });
  return user;
}

async function roleWith(name: string, perms: string[]) {
  const role = await prisma.role.create({ data: { name, description: name } });
  for (const p of perms) {
    const perm = await prisma.permission.upsert({
      where: { name: p },
      update: {},
      create: { name: p, resource: p.split('.')[0]!, action: p.split('.')[1]! },
    });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
  }
  return role;
}

// The token claims everything; only the database may decide
const tokenFor = (userId: string, portal?: 'admin' | 'faculty') =>
  signAccessToken({
    sub: userId,
    email: 'a@test.com',
    roles: ['admin'],
    permissions: ['*'],
    ...(portal && { portal }),
  });

const get = (path: string, token: string) =>
  request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

describe('admin permissions are read from the database on every request', () => {
  it('a removed permission blocks the very next request, with the same token', async () => {
    const role = await roleWith('support', ['user.read']);
    const user = await makeUser([role.id]);
    const token = tokenFor(user.id, 'admin');

    expect((await get('/users', token)).status).toBe(200);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    expect((await get('/users', token)).status).toBe(403);
  });

  it('a user the token does not know about is denied by default', async () => {
    const role = await roleWith('empty', []);
    const user = await makeUser([role.id]);
    expect((await get('/users', tokenFor(user.id, 'admin'))).status).toBe(403);
  });

  it('deactivating the user blocks the next request with 401', async () => {
    const role = await roleWith('support', ['user.read']);
    const user = await makeUser([role.id]);
    const token = tokenFor(user.id, 'admin');
    expect((await get('/users', token)).status).toBe(200);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await get('/users', token)).status).toBe(401);
  });

  it('deactivating the role blocks the next request with 403', async () => {
    const role = await roleWith('support', ['user.read']);
    const user = await makeUser([role.id]);
    const token = tokenFor(user.id, 'admin');
    expect((await get('/users', token)).status).toBe(200);
    await prisma.role.update({ where: { id: role.id }, data: { isActive: false } });
    expect((await get('/users', token)).status).toBe(403);
  });

  it('a custom role can read its own permissions at /admin/me/permissions', async () => {
    const role = await roleWith('support', ['user.read']);
    const user = await makeUser([role.id]);
    const res = await get('/admin/me/permissions', tokenFor(user.id, 'admin'));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      roles: ['support'],
      permissions: ['user.read'],
      mustChangePassword: false,
    });
  });

  it('student and faculty tokens are untouched: their claims still decide', async () => {
    const role = await roleWith('empty', []);
    const user = await makeUser([role.id]);
    // portal 'faculty' claims user.read in the token and holds nothing in the database
    const token = signAccessToken({
      sub: user.id,
      email: 'f@test.com',
      roles: ['faculty'],
      permissions: ['user.read'],
      portal: 'faculty',
    });
    expect((await get('/users', token)).status).toBe(200);
  });
});

describe('guardrails', () => {
  async function superAdmin() {
    const role =
      (await prisma.role.findFirst({ where: { name: 'super_admin' } })) ??
      (await prisma.role.create({ data: { name: 'super_admin', isSystem: true } }));
    const perm = await prisma.permission.upsert({
      where: { name: '*' },
      update: {},
      create: { name: '*', resource: '*', action: '*' },
    });
    await prisma.rolePermission.createMany({
      data: [{ roleId: role.id, permissionId: perm.id }],
      skipDuplicates: true,
    });
    const user = await makeUser([role.id]);
    return { role, user, token: tokenFor(user.id, 'admin') };
  }

  const send = async (
    method: 'put' | 'patch' | 'delete',
    path: string,
    token: string,
    body?: object
  ) => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    return request(app)
      [method](`/api/v1${path}`)
      .set('Cookie', csrfCookie ?? '')
      .set('x-csrf-token', csrfToken)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  };

  it('the last active super admin cannot be deactivated', async () => {
    const { user, token } = await superAdmin();
    const res = await send('put', `/admin/users/${user.id}/active`, token, { isActive: false });
    expect(res.status).toBe(409);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.isActive).toBe(true);
  });

  it('a super admin can be deactivated while another remains', async () => {
    const a = await superAdmin();
    const b = await superAdmin();
    const res = await send('put', `/admin/users/${b.user.id}/active`, a.token, { isActive: false });
    expect(res.status).toBe(200);
  });

  it('nobody changes their own roles', async () => {
    const { user, token } = await superAdmin();
    const other = await prisma.role.create({ data: { name: 'other' } });
    const res = await send('put', `/users/${user.id}/roles`, token, { roleIds: [other.id] });
    expect(res.status).toBe(403);
  });

  it('a role with users cannot be deleted, and the message says why', async () => {
    const { token } = await superAdmin();
    const role = await roleWith('busy', []);
    await makeUser([role.id]);
    const res = await send('delete', `/roles/${role.id}`, token);
    expect(res.status).toBe(409);
    expect(res.body.message ?? res.body.error?.message).toMatch(/assigned to 1 user/);
  });

  it('the super_admin role cannot be edited', async () => {
    const { role, token } = await superAdmin();
    const res = await send('patch', `/roles/${role.id}`, token, { isActive: false });
    expect(res.status).toBe(403);
  });

  it('role changes are written to the audit log with before and after', async () => {
    const { token } = await superAdmin();
    const role = await roleWith('editable', []);
    await send('patch', `/roles/${role.id}`, token, { description: 'new words' });
    const entry = await prisma.auditLog.findFirst({
      where: { action: 'role.update', resourceId: role.id },
    });
    expect((entry?.previousValue as { description: string }).description).toBe('editable');
    expect((entry?.newValue as { description: string }).description).toBe('new words');
  });
});

describe('roles list audience', () => {
  it('audience=admin leaves out the student and faculty portal roles, and nothing else', async () => {
    for (const name of ['student', 'faculty', 'admin', 'super_admin'])
      await prisma.role.create({ data: { name, isSystem: true } });
    await prisma.role.create({ data: { name: 'support' } });
    const role = await roleWith('lister', ['role.read']);
    const user = await makeUser([role.id]);
    const token = tokenFor(user.id, 'admin');
    const names = (res: request.Response) =>
      res.body.data.map((r: { name: string }) => r.name).sort();
    expect(names(await get('/roles?audience=admin', token))).toEqual([
      'admin',
      'lister',
      'super_admin',
      'support',
    ]);
    expect(names(await get('/roles', token))).toContain('student');
  });
});

describe('users list', () => {
  it('audience=admin leaves out student and faculty accounts but keeps people with no role; roleId filters and roles are listed', async () => {
    const student = await prisma.role.create({ data: { name: 'student', isSystem: true } });
    const faculty = await prisma.role.create({ data: { name: 'faculty', isSystem: true } });
    const support = await prisma.role.create({ data: { name: 'support' } });
    const reader = await makeUser([(await roleWith('user-lister', ['user.read'])).id]);
    const onlyStudent = await makeUser([student.id]);
    const onlyFaculty = await makeUser([faculty.id]);
    const mixed = await makeUser([faculty.id, support.id]);
    const noRole = await makeUser([]);
    const token = tokenFor(reader.id, 'admin');
    const ids = (res: request.Response) => res.body.data.map((u: { id: string }) => u.id);

    const admin = await get('/users?audience=admin&limit=100', token);
    expect(ids(admin)).toEqual(expect.arrayContaining([reader.id, mixed.id, noRole.id]));
    expect(ids(admin)).not.toContain(onlyStudent.id);
    expect(ids(admin)).not.toContain(onlyFaculty.id);
    expect(ids(await get('/users?limit=100', token))).toContain(onlyStudent.id);

    const held = await get(`/users?roleId=${support.id}`, token);
    expect(ids(held)).toEqual([mixed.id]);
    expect(held.body.data[0].roles.map((r: { name: string }) => r.name).sort()).toEqual([
      'faculty',
      'support',
    ]);
  });
});

describe('activity log views', () => {
  it('shows named actions and failures by default, and raw requests under view=requests', async () => {
    const role = await roleWith('auditor', ['audit.read']);
    const user = await makeUser([role.id]);
    const token = tokenFor(user.id, 'admin');
    const row = (action: string, severity = 'INFO') =>
      prisma.auditLog.create({
        data: {
          traceId: 't', correlationId: 'c', ipAddress: '1.1.1.1', userAgent: 'x', severity,
          entity: 'faculty_profile', action, hash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
          previousHash: '0'.repeat(64),
        },
      });
    await row('faculty.approved');
    await row('read');
    await row('update', 'SECURITY');
    const actions = async (q: string) =>
      (await get(`/audit?entity=faculty_profile&limit=50${q}`, token)).body.data
        .map((e: { action: string }) => e.action)
        .sort();
    expect(await actions('')).toEqual(['faculty.approved', 'update']);
    expect(await actions('&view=requests')).toEqual(['read']);
  });
});

describe('creating a user', () => {
  const post = async (token: string, body: object) => {
    const csrf = await getCsrfData();
    return request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', csrf.csrfCookie ?? '')
      .set('X-CSRF-Token', csrf.csrfToken)
      .send(body);
  };
  const base = () => ({ email: `n-${randomUUID()}@test.com`, fullName: 'New', password: 'Passw0rd!x' });

  it('creates the account verified with its roles in one step, so it can sign in', async () => {
    const support = await prisma.role.create({ data: { name: 'helpdesk' } });
    const creator = await roleWith('creator', ['user.create']);
    const token = tokenFor((await makeUser([creator.id])).id, 'admin');
    const res = await post(token, { ...base(), roleIds: [support.id] });
    expect(res.status).toBe(201);
    expect(res.body.data.roles.map((r: { name: string }) => r.name)).toEqual(['helpdesk']);
    const row = await prisma.user.findFirstOrThrow({ where: { id: res.body.data.id } });
    expect(row.emailVerifiedAt).not.toBeNull();
  });

  it('emails the new user their details and password, and tells the admin when that fails', async () => {
    const mail = new InMemoryEmailProvider();
    setEmailProvider(mail);
    const creator = await roleWith('creator3', ['user.create']);
    const token = tokenFor((await makeUser([creator.id])).id, 'admin');
    const body = base();
    const ok = await post(token, body);
    expect(ok.body.data.welcomeEmailSent).toBe(true);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe(body.email);
    expect(mail.sent[0]!.text).toContain(body.password);
    expect(mail.sent[0]!.text).toContain('/login');

    mail.failNext(new Error('smtp down'));
    const failed = await post(token, base());
    expect(failed.status).toBe(201);
    expect(failed.body.data.welcomeEmailSent).toBe(false);
  });

  it('answers 409, not a server error, when the address belongs to a deleted account', async () => {
    const creator = await roleWith('creator4', ['user.create']);
    const token = tokenFor((await makeUser([creator.id])).id, 'admin');
    const gone = await makeUser([]);
    await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    expect((await post(token, { ...base(), email: gone.email })).status).toBe(409);
  });

  it('refuses roles the creator does not hold, and creates nobody', async () => {
    const secret = await roleWith('secret', ['payout.approve']);
    const creator = await roleWith('creator2', ['user.create']);
    const token = tokenFor((await makeUser([creator.id])).id, 'admin');
    const body = { ...base(), roleIds: [secret.id] };
    expect((await post(token, body)).status).toBe(403);
    expect(await prisma.user.count({ where: { email: body.email } })).toBe(0);
  });
});

describe('admin-set passwords', () => {
  const post = async (path: string, token: string) => {
    const csrf = await getCsrfData();
    return request(app)
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', csrf.csrfCookie ?? '')
      .set('X-CSRF-Token', csrf.csrfToken)
      .send({});
  };

  it('a user still on an admin-set password can only reach their own sign-in and password routes', async () => {
    const role = await roleWith('pending-reader', ['user.read']);
    const user = await makeUser([role.id]);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'PENDING_ACTIVATION' } });
    const token = tokenFor(user.id, 'admin');
    expect((await get('/users', token)).status).toBe(403);
    const me = await get('/admin/me/permissions', token);
    expect(me.status).toBe(200);
    expect(me.body.data.mustChangePassword).toBe(true);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
    expect((await get('/users', token)).status).toBe(200);
  });

  it('reset emails a new password without returning it, ends sessions, and forces a change', async () => {
    const mail = new InMemoryEmailProvider();
    setEmailProvider(mail);
    const resetter = await roleWith('resetter', ['user.update']);
    const token = tokenFor((await makeUser([resetter.id])).id, 'admin');
    const target = await makeUser([]);
    const res = await post(`/users/${target.id}/reset-password`, token);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/Password:/);
    expect(res.body.data.welcomeEmailSent).toBe(true);
    expect(mail.sent[0]!.to).toBe(target.email);
    expect(mail.sent[0]!.text).toMatch(/Password: \S{14}/);
    const row = await prisma.user.findFirstOrThrow({ where: { id: target.id } });
    expect(row.status).toBe('PENDING_ACTIVATION');
    expect(row.passwordHash).not.toBe('x');
  });

  it('reset refuses yourself, and an admin account unless you are a Super Admin', async () => {
    const resetter = await roleWith('resetter2', ['user.update']);
    const me = await makeUser([resetter.id]);
    const token = tokenFor(me.id, 'admin');
    expect((await post(`/users/${me.id}/reset-password`, token)).status).toBe(403);
    const adminRole = await prisma.role.create({ data: { name: 'admin', isSystem: true } });
    const boss = await makeUser([adminRole.id]);
    expect((await post(`/users/${boss.id}/reset-password`, token)).status).toBe(403);
  });
});
