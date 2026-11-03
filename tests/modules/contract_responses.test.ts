import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { contractResponseErrors, expectContractResponse } from '../helpers/contract.js';
import { prisma } from '@infrastructure/database/index.js';

/**
 * Response shapes of implemented contract routes (LMS-93). New endpoint tests
 * should call expectContractResponse themselves; this file covers routes that
 * already existed when the check was added.
 */

const EMAIL = 'contract-probe@example.com';
const PASSWORD = 'Password123!';

interface Session {
  csrfToken: string;
  csrfCookie: string;
  bearer: { Authorization: string };
  accessCookie: string;
  refreshCookie: string;
}

async function registerAndLogin(): Promise<Session> {
  const { csrfToken, csrfCookie } = await getCsrfData();
  await request(app)
    .post('/api/v1/auth/register')
    .set('Cookie', csrfCookie)
    .set('x-csrf-token', csrfToken)
    .send({ email: EMAIL, password: PASSWORD, fullName: 'Contract Probe' });

  const role = await prisma.role.create({ data: { name: 'super_admin' } });
  const permission = await prisma.permission.create({
    data: { name: '*', resource: '*', action: '*' },
  });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  const user = await prisma.user.findFirstOrThrow({ where: { email: EMAIL } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

  const login = await request(app)
    .post('/api/v1/auth/login')
    .set('Cookie', csrfCookie)
    .set('x-csrf-token', csrfToken)
    .send({ email: EMAIL, password: PASSWORD });
  const cookies = login.headers['set-cookie'] as unknown as string[];
  const accessCookie = cookies.find((c) => c.startsWith('accessToken='))!.split(';')[0]!;
  const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='))!.split(';')[0]!;
  return {
    csrfToken,
    csrfCookie,
    bearer: { Authorization: `Bearer ${accessCookie.split('=')[1]}` },
    accessCookie,
    refreshCookie,
  };
}

describe('Implemented routes match the contract response schemas', () => {
  let s: Session;

  beforeEach(async () => {
    s = await registerAndLogin();
  });

  it('GET /auth/csrf-token', async () => {
    const res = await request(app).get('/api/v1/auth/csrf-token');
    expect(res.status).toBe(200);
    expectContractResponse(res, 'get', '/auth/csrf-token');
  });

  it('DELETE /auth/sessions', async () => {
    const res = await request(app)
      .delete('/api/v1/auth/sessions')
      .set(s.bearer)
      .set('Cookie', s.csrfCookie)
      .set('x-csrf-token', s.csrfToken);
    expect(res.status).toBe(200);
    expectContractResponse(res, 'delete', '/auth/sessions');
  });

  it('POST /auth/logout', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', `${s.csrfCookie}; ${s.accessCookie}; ${s.refreshCookie}`)
      .set('x-csrf-token', s.csrfToken);
    expect(res.status).toBe(200);
    expectContractResponse(res, 'post', '/auth/logout');
  });

  it('401 error envelope (GET /auth/me without a token)', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expectContractResponse(res, 'get', '/auth/me');
  });

  it('422 error envelope (GET /audit with an invalid page)', async () => {
    const res = await request(app).get('/api/v1/audit?page=0').set(s.bearer);
    expect(res.status).toBe(422);
    expectContractResponse(res, 'get', '/audit');
  });
});

/**
 * Template implementations whose responses do not match the contract yet. Each
 * entry names the ticket that fixes it. The test fails when a route starts
 * matching, so the entry is removed and the route moves to the suite above.
 */
describe('Known contract mismatches', () => {
  let s: Session;

  beforeEach(async () => {
    s = await registerAndLogin();
  });

  const KNOWN_MISMATCHES: Array<{
    label: string;
    fixedBy: string;
    call: (s: Session) => request.Test;
    method: string;
    path: string;
  }> = [
    {
      label: 'GET /auth/me 200',
      fixedBy: 'LMS-100 (profile shape: mobileNumber, emailVerified, portal role names)',
      call: (s) => request(app).get('/api/v1/auth/me').set(s.bearer),
      method: 'get',
      path: '/auth/me',
    },
    {
      label: 'GET /auth/sessions 200',
      fixedBy: 'LMS-100 (pagination meta, isCurrent, no IP address)',
      call: (s) => request(app).get('/api/v1/auth/sessions').set(s.bearer),
      method: 'get',
      path: '/auth/sessions',
    },
    {
      label: 'POST /auth/refresh 200',
      fixedBy: 'LMS-100 (response body shape)',
      call: (s) =>
        request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${s.csrfCookie}; ${s.refreshCookie}`)
          .set('x-csrf-token', s.csrfToken),
      method: 'post',
      path: '/auth/refresh',
    },
    {
      label: 'GET /audit 200',
      fixedBy:
        'Not ticketed yet: align GET /audit with the contract (redacted fields, filters, date window)',
      call: (s) => request(app).get('/api/v1/audit').set(s.bearer),
      method: 'get',
      path: '/audit',
    },
  ];

  it.each(KNOWN_MISMATCHES)('$label still differs ($fixedBy)', async (entry) => {
    const res = await entry.call(s);
    expect(res.status).toBe(Number(entry.label.split(' ').pop()));
    const errors = contractResponseErrors(
      entry.method,
      `/api/v1${entry.path}`,
      res.status,
      res.body
    );
    // If this fails, the route now matches: delete the entry and add it to the suite above.
    expect(errors.length).toBeGreaterThan(0);
  });
});
