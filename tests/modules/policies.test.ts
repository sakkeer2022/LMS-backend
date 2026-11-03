import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { expectContractResponse } from '../helpers/contract.js';
import { fakePdf, publishAllPolicies } from '../helpers/policies.js';
import { seedCountries } from '../helpers/regions.js';
import { prisma } from '@infrastructure/database/index.js';
import { getTestStorage, sha256Hex } from '@infrastructure/storage/index.js';
import { publishPolicy } from '@modules/policies/index.js';

const CURRENT = '/api/v1/policies/current';

describe('policies', () => {
  beforeEach(async () => {
    getTestStorage().clear();
    await seedCountries();
  });

  it('lists the four current policies for a country', async () => {
    const india = await publishAllPolicies('IN');
    const res = await request(app).get(`${CURRENT}?country=IN`);
    expect(res.status).toBe(200);
    expectContractResponse(res, 'get', '/policies/current');
    expect(res.body.data.map((p: { type: string }) => p.type)).toEqual([
      'terms_of_use',
      'privacy_policy',
      'child_safety_policy',
      'student_terms',
    ]);
    expect(res.body.data[3]).toMatchObject({
      id: india.STUDENT_TERMS.id,
      country: 'IN',
      version: '1.0',
    });
  });

  it('gives each country its own texts and never falls back to another country', async () => {
    const india = await publishAllPolicies('IN');
    const unfinished = await request(app).get(`${CURRENT}?country=AE`);
    expect(unfinished.status).toBe(503);

    const uae = await publishAllPolicies('AE');
    const res = await request(app).get(`${CURRENT}?country=ae`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: { id: string }) => p.id);
    expect(ids).toEqual(Object.values(uae).map((p) => p.id));
    for (const policy of Object.values(india)) expect(ids).not.toContain(policy.id);
  });

  it('answers 503 when only some of the four are loaded', async () => {
    await publishPolicy({
      type: 'TERMS_OF_USE',
      country: 'IN',
      version: '1.0',
      title: 'Terms',
      effectiveAt: new Date(),
      pdf: fakePdf('only one'),
    });
    expect((await request(app).get(`${CURRENT}?country=IN`)).status).toBe(503);
  });

  it('rejects a missing, malformed or unsupported country', async () => {
    await publishAllPolicies('IN');
    expect((await request(app).get(CURRENT)).status).toBe(422);
    expect((await request(app).get(`${CURRENT}?country=INDIA`)).status).toBe(422);
    expect((await request(app).get(`${CURRENT}?country=FR`)).status).toBe(422);
    expect((await request(app).get(`${CURRENT}?country=IN&x=1`)).status).toBe(422);
  });

  it('serves the policy PDF inline with a public cache and its hash', async () => {
    const india = await publishAllPolicies('IN');
    const policy = india.STUDENT_TERMS;
    const res = await request(app)
      .get(`/api/v1/policies/${policy.id}/file`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(
      /^inline; filename="student-terms-in-1\.0\.pdf"$/
    );
    expect(res.headers['cache-control']).toContain('public');
    expect(res.headers['etag']).toBe(`"${policy.sha256}"`);
    expect(sha256Hex(res.body as Buffer)).toBe(policy.sha256);
  });

  it('returns 404 for an unknown policy and 422 for a malformed id', async () => {
    expect(
      (await request(app).get('/api/v1/policies/00000000-0000-4000-8000-000000000000/file')).status
    ).toBe(404);
    expect((await request(app).get('/api/v1/policies/nope/file')).status).toBe(422);
  });

  it('answers 503 when the file is gone from storage or no longer matches its hash', async () => {
    const india = await publishAllPolicies('IN');
    const row = await prisma.policyDocument.findUniqueOrThrow({
      where: { id: india.TERMS_OF_USE.id },
    });
    const storage = getTestStorage();
    await storage.put(row.storageKey, Buffer.from('tampered'), 'application/pdf');
    expect((await request(app).get(`/api/v1/policies/${india.TERMS_OF_USE.id}/file`)).status).toBe(
      503
    );
    await storage.delete(row.storageKey);
    expect((await request(app).get(`/api/v1/policies/${india.TERMS_OF_USE.id}/file`)).status).toBe(
      503
    );
  });

  it('keeps the previous version on record when a new one becomes current', async () => {
    const v1 = await publishAllPolicies('IN', '1.0');
    const v2 = await publishAllPolicies('IN', '2.0');
    const res = await request(app).get(`${CURRENT}?country=IN`);
    expect(res.body.data.map((p: { version: string }) => p.version)).toEqual([
      '2.0',
      '2.0',
      '2.0',
      '2.0',
    ]);
    const old = await prisma.policyDocument.findUniqueOrThrow({
      where: { id: v1.STUDENT_TERMS.id },
    });
    expect(old.isCurrent).toBe(false);
    expect(v2.STUDENT_TERMS.id).not.toBe(v1.STUDENT_TERMS.id);
  });

  it('allows only one current version per type and country in the database', async () => {
    const india = await publishAllPolicies('IN');
    const row = await prisma.policyDocument.findUniqueOrThrow({
      where: { id: india.PRIVACY_POLICY.id },
    });
    await expect(
      prisma.policyDocument.create({
        data: {
          type: row.type,
          country: row.country,
          version: '9.9',
          title: 'Another',
          effectiveAt: new Date(),
          storageKey: 'policies/another.pdf',
          sha256: 'b'.repeat(64),
          isCurrent: true,
        },
      })
    ).rejects.toThrow();
  });
});

describe('regions API', () => {
  beforeEach(seedCountries);

  it('lists the active countries for the mobile picker, publicly cacheable', async () => {
    const res = await request(app).get('/api/v1/regions/countries');
    expect(res.status).toBe(200);
    expectContractResponse(res, 'get', '/regions/countries');
    expect(res.headers['cache-control']).toContain('public');
    expect(res.body.data).toEqual([
      {
        code: 'IN',
        name: 'India',
        dialCode: '+91',
        defaultTimezone: 'Asia/Kolkata',
        guardianConsentAge: 18,
      },
      {
        code: 'AE',
        name: 'United Arab Emirates',
        dialCode: '+971',
        defaultTimezone: 'Asia/Dubai',
        guardianConsentAge: 18,
      },
    ]);
  });
});
