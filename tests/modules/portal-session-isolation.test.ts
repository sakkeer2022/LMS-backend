import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { TEST_PASSWORD } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';

type Portal = 'faculty' | 'admin';

const setCookies = (res: request.Response): string[] =>
  (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
const pair = (res: request.Response, name: string): string => {
  const found = setCookies(res).find((c) => c.startsWith(`${name}=`));
  if (!found) throw new Error(`no ${name} cookie`);
  return found.split(';')[0] as string;
};

async function createUser(email: string, roleName: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  return prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      fullName: `${roleName} test`,
      emailVerifiedAt: new Date(),
      roles: { create: { roleId: role.id } },
    },
  });
}

async function csrf(portal: Portal) {
  const res = await request(app).get('/api/v1/auth/csrf-token').set('x-portal', portal);
  return { token: res.body.data.csrfToken as string, cookie: pair(res, `${portal}__csrf`), res };
}

async function login(portal: Portal, email: string) {
  const { token, cookie } = await csrf(portal);
  return request(app)
    .post(`/api/v1/auth/${portal}/login`)
    .set('x-portal', portal)
    .set('Cookie', cookie)
    .set('x-csrf-token', token)
    .send({ email, password: TEST_PASSWORD });
}

describe('Portal session isolation', () => {
  let adminLogin: request.Response;
  let facultyLogin: request.Response;
  let jar: string;

  beforeEach(async () => {
    await seedRbac(prisma);
    await createUser('iso-admin@example.com', 'admin');
    await createUser('iso-faculty@example.com', 'faculty');
    adminLogin = await login('admin', 'iso-admin@example.com');
    facultyLogin = await login('faculty', 'iso-faculty@example.com');
    jar = [
      pair(adminLogin, 'admin_accessToken'),
      pair(adminLogin, 'admin_refreshToken'),
      pair(facultyLogin, 'faculty_accessToken'),
      pair(facultyLogin, 'faculty_refreshToken'),
    ].join('; ');
  });

  it('gives each portal its own cookie names and none of the unscoped ones', () => {
    expect(adminLogin.status).toBe(200);
    expect(facultyLogin.status).toBe(200);
    for (const res of [adminLogin, facultyLogin]) {
      expect(setCookies(res).some((c) => /^(accessToken|refreshToken)=/.test(c))).toBe(false);
    }
  });

  it('answers each portal with its own user when both sessions share one cookie jar', async () => {
    const admin = await request(app).get('/api/v1/auth/me').set('x-portal', 'admin').set('Cookie', jar);
    const faculty = await request(app).get('/api/v1/auth/me').set('x-portal', 'faculty').set('Cookie', jar);
    expect(admin.body.data.email).toBe('iso-admin@example.com');
    expect(faculty.body.data.email).toBe('iso-faculty@example.com');
  });

  it('rejects a token from another portal even when it sits in this portal cookie', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('x-portal', 'admin')
      .set('Cookie', pair(facultyLogin, 'faculty_accessToken').replace('faculty_', 'admin_'));
    expect(res.status).toBe(401);
  });

  it('logs out one portal without touching the other', async () => {
    const { token, cookie } = await csrf('faculty');
    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set('x-portal', 'faculty')
      .set('Cookie', `${jar}; ${cookie}`)
      .set('x-csrf-token', token);
    expect(out.status).toBe(200);
    const cleared = setCookies(out).map((c) => c.split('=')[0]);
    expect(cleared).toEqual(expect.arrayContaining(['faculty_accessToken', 'faculty_refreshToken']));
    expect(cleared.some((n) => n?.startsWith('admin_'))).toBe(false);

    const admin = await request(app).get('/api/v1/auth/me').set('x-portal', 'admin').set('Cookie', jar);
    expect(admin.status).toBe(200);
  });

  it('refreshes only the calling portal and rotates only its cookies', async () => {
    const { token, cookie } = await csrf('admin');
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('x-portal', 'admin')
      .set('Cookie', `${jar}; ${cookie}`)
      .set('x-csrf-token', token);
    expect(res.status).toBe(200);
    const names = setCookies(res).map((c) => c.split('=')[0]);
    expect(names).toEqual(expect.arrayContaining(['admin_accessToken', 'admin_refreshToken']));
    expect(names.some((n) => n?.startsWith('faculty_'))).toBe(false);
  });

  it('refuses a refresh for a portal that has no refresh cookie of its own', async () => {
    const { token, cookie } = await csrf('admin');
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('x-portal', 'admin')
      .set('Cookie', `${pair(facultyLogin, 'faculty_refreshToken')}; ${cookie}`)
      .set('x-csrf-token', token);
    expect(res.status).toBe(401);
  });

  it('does not accept another portal\'s CSRF cookie', async () => {
    const faculty = await csrf('faculty');
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('x-portal', 'admin')
      .set('Cookie', `${jar}; ${faculty.cookie}`)
      .set('x-csrf-token', faculty.token);
    expect(res.status).toBe(403);
  });

  it('rejects a login whose portal header does not match the route', async () => {
    const { token, cookie } = await csrf('faculty');
    const res = await request(app)
      .post('/api/v1/auth/admin/login')
      .set('x-portal', 'faculty')
      .set('Cookie', cookie)
      .set('x-csrf-token', token)
      .send({ email: 'iso-admin@example.com', password: TEST_PASSWORD });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(setCookies(res).some((c) => /accessToken=/.test(c))).toBe(false);
  });
});
