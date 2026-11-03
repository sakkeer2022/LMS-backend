import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { contractResponseErrors, expectContractResponse } from '../helpers/contract.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';
import { loginWithRole } from '../helpers/users.js';

/**
 * Response shapes of implemented contract routes (LMS-93). New endpoint tests
 * should call expectContractResponse themselves; this file covers routes that
 * already existed when the check was added.
 */

interface Session {
  csrfToken: string;
  csrfCookie: string;
  bearer: { Authorization: string };
  accessCookie: string;
  refreshCookie: string;
}

async function adminSession(): Promise<Session> {
  await seedRbac(prisma);
  const login = await loginWithRole('super_admin', 'contract-probe@example.com');
  return {
    csrfToken: login.csrfToken,
    csrfCookie: login.csrfCookie,
    bearer: { Authorization: `Bearer ${login.token}` },
    accessCookie: login.accessCookie,
    refreshCookie: login.refreshCookie,
  };
}

describe('Implemented routes match the contract response schemas', () => {
  let s: Session;

  beforeEach(async () => {
    s = await adminSession();
  });

  it('GET /auth/csrf-token', async () => {
    const res = await request(app).get('/api/v1/auth/csrf-token');
    expect(res.status).toBe(200);
    expectContractResponse(res, 'get', '/auth/csrf-token');
  });

  it('GET /auth/me', async () => {
    const res = await request(app).get('/api/v1/auth/me').set(s.bearer);
    expect(res.status).toBe(200);
    expectContractResponse(res, 'get', '/auth/me');
  });

  it('GET /auth/sessions', async () => {
    const res = await request(app).get('/api/v1/auth/sessions').set(s.bearer);
    expect(res.status).toBe(200);
    expectContractResponse(res, 'get', '/auth/sessions');
  });

  it('POST /auth/refresh', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${s.csrfCookie}; ${s.refreshCookie}`)
      .set('x-csrf-token', s.csrfToken);
    expect(res.status).toBe(200);
    expectContractResponse(res, 'post', '/auth/refresh');
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
    s = await adminSession();
  });

  const KNOWN_MISMATCHES: Array<{
    label: string;
    fixedBy: string;
    call: (s: Session) => request.Test;
    method: string;
    path: string;
  }> = [
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
