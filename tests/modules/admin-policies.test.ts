import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { expectContractResponse } from '../helpers/contract.js';
import { blankPolicyPdf } from '../helpers/pdf.js';
import { publishAllPolicies } from '../helpers/policies.js';
import { seedCountries } from '../helpers/regions.js';
import { loginWithRole, reauthenticate, type LoggedInUser } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';
import { getTestStorage } from '@infrastructure/storage/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';

const BASE = '/api/v1/admin/policies';

interface Upload {
  type?: string;
  country?: string;
  version?: string;
  title?: string;
  effectiveAt?: string;
  file?: Buffer | null;
  extra?: Record<string, string>;
}

async function upload(admin: LoggedInUser, options: Upload = {}): Promise<request.Response> {
  const { csrfToken, csrfCookie } = await getCsrfData();
  const call = request(app)
    .post(BASE)
    .set('Authorization', `Bearer ${admin.token}`)
    .set('Cookie', csrfCookie)
    .set('x-csrf-token', csrfToken)
    .field('type', options.type ?? 'student_terms')
    .field('country', options.country ?? 'IN')
    .field('version', options.version ?? '1.0')
    .field('title', options.title ?? 'Student Terms')
    .field('effectiveAt', options.effectiveAt ?? '2026-09-01');
  for (const [key, value] of Object.entries(options.extra ?? {})) call.field(key, value);
  const file = options.file === undefined ? await blankPolicyPdf(2, 'Uploaded') : options.file;
  if (file) call.attach('file', file, { filename: 'terms.pdf', contentType: 'application/pdf' });
  return call;
}

describe('admin policies', () => {
  let admin: LoggedInUser;

  beforeEach(async () => {
    getTestStorage().clear();
    await seedCountries();
    await seedRbac(prisma);
    admin = await loginWithRole('admin', 'legal@example.org');
    await reauthenticate(admin);
  });

  it('lists the missing policies per country until they are all uploaded', async () => {
    const empty = await request(app)
      .get(`${BASE}/coverage`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(empty.status).toBe(200);
    expectContractResponse(empty, 'get', '/admin/policies/coverage');
    expect(empty.body.data).toEqual([
      {
        country: 'IN',
        name: 'India',
        missingTypes: ['terms_of_use', 'privacy_policy', 'child_safety_policy', 'student_terms'],
      },
      {
        country: 'AE',
        name: 'United Arab Emirates',
        missingTypes: ['terms_of_use', 'privacy_policy', 'child_safety_policy', 'student_terms'],
      },
    ]);

    await publishAllPolicies('IN');
    const after = await request(app)
      .get(`${BASE}/coverage`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(after.body.data[0].missingTypes).toEqual([]);
    expect(after.body.data[1].missingTypes).toHaveLength(4);
  });

  it('uploads a version for each country and makes it current', async () => {
    for (const country of ['IN', 'AE']) {
      const res = await upload(admin, { country });
      expect(res.status).toBe(201);
      expectContractResponse(res, 'post', '/admin/policies');
      expect(res.body.data).toMatchObject({
        type: 'student_terms',
        country,
        version: '1.0',
        isCurrent: true,
      });
    }
    for (const type of ['terms_of_use', 'privacy_policy', 'child_safety_policy']) {
      expect((await upload(admin, { type, title: type })).status).toBe(201);
    }
    const students = await request(app).get('/api/v1/policies/current?country=IN');
    expect(students.status).toBe(200);
    const terms = students.body.data.find((p: { type: string }) => p.type === 'student_terms');
    expect(terms.title).toBe('Student Terms');
  });

  it('keeps the old version on record when a new one is uploaded, and and lists past and current versions', async () => {
    const v1 = (await upload(admin, { version: '1.0' })).body.data;
    const v2 = (await upload(admin, { version: '2.0' })).body.data;
    expect(v2.isCurrent).toBe(true);

    const list = await request(app)
      .get(`${BASE}?country=IN&type=student_terms`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(list.status).toBe(200);
    expectContractResponse(list, 'get', '/admin/policies');
    expect(
      list.body.data.map((p: { version: string; isCurrent: boolean }) => [p.version, p.isCurrent])
    ).toEqual([
      ['2.0', true],
      ['1.0', false],
    ]);
  });

  it('rolls back to an earlier version with one CSRF pair, audits it, and 404s an unknown one', async () => {
    const v1 = (await upload(admin, { version: '1.0' })).body.data;
    await upload(admin, { version: '2.0' });
    const { csrfToken, csrfCookie } = await getCsrfData();
    const put = (id: string): request.Test =>
      request(app)
        .put(`${BASE}/${id}/current`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('Cookie', csrfCookie)
        .set('x-csrf-token', csrfToken);

    const res = await put(v1.id);
    expect(res.status).toBe(200);
    expectContractResponse(res, 'put', '/admin/policies/{policyId}/current');
    expect(res.body.data).toMatchObject({ version: '1.0', isCurrent: true });
    const now = await request(app)
      .get(`${BASE}?type=student_terms&country=IN`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(now.body.data.filter((p: { isCurrent: boolean }) => p.isCurrent)).toHaveLength(1);
    expect(
      await prisma.auditLog.count({ where: { action: 'policy.set_current', resourceId: v1.id } })
    ).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'policy.published' } })).toBe(2);

    expect((await put('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await put('nope')).status).toBe(422);
  });

  it('refuses a duplicate version with 409', async () => {
    expect((await upload(admin, { version: '1.0' })).status).toBe(201);
    expect((await upload(admin, { version: '1.0' })).status).toBe(409);
    // The same version number is fine for another country or another type
    expect((await upload(admin, { version: '1.0', country: 'AE' })).status).toBe(201);
    expect((await upload(admin, { version: '1.0', type: 'privacy_policy' })).status).toBe(201);
  });

  it('checks the file and the fields', async () => {
    expect((await upload(admin, { file: Buffer.from('this is not a pdf') })).status).toBe(422);
    expect((await upload(admin, { file: Buffer.from('%PDF-1.7 but broken') })).status).toBe(422);
    expect((await upload(admin, { file: null })).status).toBe(400);
    expect((await upload(admin, { country: 'FR' })).status).toBe(422);
    expect((await upload(admin, { type: 'faculty_terms' })).status).toBe(422);
    expect((await upload(admin, { version: 'v 1' })).status).toBe(422);
    expect((await upload(admin, { title: '  ' })).status).toBe(422);
    expect((await upload(admin, { effectiveAt: 'soon' })).status).toBe(422);
    expect((await upload(admin, { extra: { isCurrent: 'true' } })).status).toBe(422);
    expect(await prisma.policyDocument.count()).toBe(0);
    expect(getTestStorage().files.size).toBe(0);
  });

  it('refuses a file over the size limit with 413', async () => {
    const big = Buffer.concat([await blankPolicyPdf(1), Buffer.alloc(11 * 1024 * 1024)]);
    expect((await upload(admin, { file: big })).status).toBe(413);
  });

  it('needs the permission, recent reauthentication, a session and a CSRF token', async () => {
    const faculty = await loginWithRole('faculty', 'teacher@example.org');
    await reauthenticate(faculty);
    expect((await upload(faculty)).status).toBe(403);
    expect(
      (await request(app).get(BASE).set('Authorization', `Bearer ${faculty.token}`)).status
    ).toBe(403);
    expect(
      (await request(app).get(`${BASE}/coverage`).set('Authorization', `Bearer ${faculty.token}`))
        .status
    ).toBe(403);
    expect((await request(app).get(BASE)).status).toBe(401);

    const fresh = await loginWithRole('admin', 'second-admin@example.org'); // no reauthentication yet
    expect((await upload(fresh)).status).toBe(403);
    expect(
      (await request(app).get(BASE).set('Authorization', `Bearer ${fresh.token}`)).status
    ).toBe(200);

    const noCsrf = await request(app)
      .post(BASE)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('type', 'student_terms');
    expect(noCsrf.status).toBe(403);
    expect(await prisma.policyDocument.count()).toBe(0);
  });
});
