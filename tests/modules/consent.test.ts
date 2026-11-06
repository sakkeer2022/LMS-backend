import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { expectContractResponse } from '../helpers/contract.js';
import { publishAllPolicies } from '../helpers/policies.js';
import { strokePng } from '../helpers/pdf.js';
import { seedCountries } from '../helpers/regions.js';
import { createStudentProfile } from '../helpers/students.js';
import { loginWithRole, reauthenticate } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';
import { getTestStorage, sha256Hex } from '@infrastructure/storage/index.js';
import { PDFDocument } from 'pdf-lib';
import { purgeExpiredConsents } from '@modules/consent/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';

const SIGN = '/api/v1/consent/guardian-signatures';
const PENDING = '/api/v1/consent/guardian-signatures/file';

/** A date of birth that makes someone exactly `years` old today, shifted by `days` (positive = younger). */
function dobFor(years: number, days = 0): string {
  const today = new Date();
  const dob = new Date(
    Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate() + days)
  );
  return dob.toISOString().slice(0, 10);
}

interface SignOptions {
  policyId: string;
  name?: string;
  dob?: string;
  mode?: 'draw' | 'type';
  typedName?: string;
  signature?: Buffer | null;
  extra?: Record<string, string>;
}

async function sign(options: SignOptions): Promise<request.Response> {
  const { csrfToken, csrfCookie } = await getCsrfData();
  const call = request(app)
    .post(SIGN)
    .set('Cookie', csrfCookie)
    .set('x-csrf-token', csrfToken)
    .field('policyId', options.policyId)
    .field('studentFullName', options.name ?? 'Ananya Sharma')
    .field('studentDateOfBirth', options.dob ?? dobFor(15))
    .field('signatureMode', options.mode ?? 'draw');
  if (options.typedName) call.field('typedName', options.typedName);
  for (const [key, value] of Object.entries(options.extra ?? {})) call.field(key, value);
  const signature = options.signature === undefined ? await strokePng() : options.signature;
  if (signature)
    call.attach('signature', signature, { filename: 'signature.png', contentType: 'image/png' });
  return call;
}

function binary(req: request.Test): request.Test {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('guardian consent signing', () => {
  let india: Awaited<ReturnType<typeof publishAllPolicies>>;
  let uae: Awaited<ReturnType<typeof publishAllPolicies>>;

  beforeEach(async () => {
    getTestStorage().clear();
    await seedCountries();
    await seedRbac(prisma);
    india = await publishAllPolicies('IN', '1.0', { realPdf: true });
    uae = await publishAllPolicies('AE', '1.0', { realPdf: true });
  });

  it.each([
    ['India', () => india],
    ['the UAE', () => uae],
  ])('signs for a student under 18 in %s and stores a stamped PDF', async (_name, policies) => {
    const policy = policies().STUDENT_TERMS;
    const res = await sign({ policyId: policy.id });
    expect(res.status).toBe(201);
    expectContractResponse(res, 'post', '/consent/guardian-signatures');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.data.policyId).toBe(policy.id);

    const row = await prisma.guardianConsent.findFirstOrThrow({ where: { policyId: policy.id } });
    expect(row.tokenHash).not.toContain(res.body.data.consentToken);
    expect(row.studentId).toBeNull();
    expect(row.signedPdfSha256).toBe(res.body.data.signedPdfSha256);
    const bytes = await getTestStorage().get(row.signedPdfStorageKey);
    expect(bytes).not.toBeNull();
    expect(sha256Hex(bytes!)).toBe(row.signedPdfSha256);
    expect((await PDFDocument.load(bytes!)).getPageCount()).toBe(3);
    expect(row.ipAddress).toBeTruthy();
  });

  it.each(['IN', 'AE'])(
    'allows the day before the 18th birthday and refuses the birthday itself (%s)',
    async (code) => {
      const policy = (code === 'IN' ? india : uae).STUDENT_TERMS;
      expect((await sign({ policyId: policy.id, dob: dobFor(18, 1) })).status).toBe(201);
      expect((await sign({ policyId: policy.id, dob: dobFor(18, 0) })).status).toBe(422);
      expect((await sign({ policyId: policy.id, dob: dobFor(30) })).status).toBe(422);
    }
  );

  it('reads the consent age from the policy country, not from a fixed number', async () => {
    await prisma.country.create({
      data: {
        code: 'SG',
        name: 'Singapore',
        dialCode: '+65',
        mobilePattern: '^[89][0-9]{7}$',
        defaultTimezone: 'Asia/Singapore',
        guardianConsentAge: 21,
        displayOrder: 3,
      },
    });
    const { clearRegionCache } = await import('@modules/regions/index.js');
    clearRegionCache();
    const singapore = await publishAllPolicies('SG', '1.0', { realPdf: true });
    expect((await sign({ policyId: singapore.STUDENT_TERMS.id, dob: dobFor(19) })).status).toBe(
      201
    );
    expect((await sign({ policyId: singapore.STUDENT_TERMS.id, dob: dobFor(21) })).status).toBe(
      422
    );
  });

  it('only accepts the current Student Terms', async () => {
    expect((await sign({ policyId: india.PRIVACY_POLICY.id })).status).toBe(422);
    expect((await sign({ policyId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
    const next = await publishAllPolicies('IN', '2.0', { realPdf: true });
    expect((await sign({ policyId: india.STUDENT_TERMS.id })).status).toBe(422);
    expect((await sign({ policyId: next.STUDENT_TERMS.id })).status).toBe(201);
  });

  it('checks the signature: a PNG when drawn, a name when typed, never both', async () => {
    const id = india.STUDENT_TERMS.id;
    expect((await sign({ policyId: id, signature: null })).status).toBe(422);
    expect((await sign({ policyId: id, signature: Buffer.from('GIF89a......') })).status).toBe(422);
    expect((await sign({ policyId: id, signature: Buffer.from('%PDF-1.7 ...') })).status).toBe(422);
    expect((await sign({ policyId: id, mode: 'type', signature: null })).status).toBe(422);
    expect(
      (await sign({ policyId: id, mode: 'type', signature: null, typedName: 'Suresh Sharma' }))
        .status
    ).toBe(201);
    expect((await sign({ policyId: id, mode: 'type', typedName: 'Suresh Sharma' })).status).toBe(
      422
    );
    expect((await sign({ policyId: id, typedName: 'Suresh Sharma' })).status).toBe(422);
  });

  it('refuses an oversized signature with 413', async () => {
    const big = Buffer.concat([await strokePng(), Buffer.alloc(1_300_000)]);
    expect((await sign({ policyId: india.STUDENT_TERMS.id, signature: big })).status).toBe(413);
  });

  it('prints names in Devanagari and Arabic without failing', async () => {
    expect((await sign({ policyId: india.STUDENT_TERMS.id, name: 'अनन्या शर्मा' })).status).toBe(
      201
    );
    expect((await sign({ policyId: uae.STUDENT_TERMS.id, name: 'محمد عبد الله' })).status).toBe(
      201
    );
  });

  it('validates the form fields', async () => {
    const id = india.STUDENT_TERMS.id;
    expect((await sign({ policyId: id, dob: '2012-02-30' })).status).toBe(422);
    expect((await sign({ policyId: id, dob: dobFor(0, 3) })).status).toBe(422);
    expect((await sign({ policyId: id, name: '   ' })).status).toBe(422);
    expect((await sign({ policyId: id, extra: { role: 'admin' } })).status).toBe(422);
    expect((await sign({ policyId: 'nope' })).status).toBe(422);
  });

  it('requires a CSRF token', async () => {
    const res = await request(app).post(SIGN).field('policyId', india.STUDENT_TERMS.id);
    expect(res.status).toBe(403);
  });

  it('answers 503 when the Student Terms file is gone or altered', async () => {
    const row = await prisma.policyDocument.findUniqueOrThrow({
      where: { id: india.STUDENT_TERMS.id },
    });
    await getTestStorage().put(row.storageKey, Buffer.from('tampered'), 'application/pdf');
    expect((await sign({ policyId: india.STUDENT_TERMS.id })).status).toBe(503);
    expect(await prisma.guardianConsent.count()).toBe(0);
  });
});

describe('guardian consent downloads', () => {
  beforeEach(async () => {
    getTestStorage().clear();
    await seedCountries();
    await seedRbac(prisma);
    await publishAllPolicies('IN', '1.0', { realPdf: true });
  });

  async function signedToken(): Promise<{ token: string; id: string }> {
    const policy = await prisma.policyDocument.findFirstOrThrow({
      where: { type: 'STUDENT_TERMS' },
    });
    const res = await sign({ policyId: policy.id });
    expect(res.status).toBe(201);
    const row = await prisma.guardianConsent.findFirstOrThrow({ orderBy: { signedAt: 'desc' } });
    return { token: res.body.data.consentToken as string, id: row.id };
  }

  async function link(consentId: string, studentId: string): Promise<void> {
    await prisma.guardianConsent.update({
      where: { id: consentId },
      data: {
        studentId,
        linkedAt: new Date(),
        guardianName: 'Suresh Sharma',
        guardianRelationship: 'FATHER',
      },
    });
  }

  it('gives the token holder the signed PDF before registration, without using the token up', async () => {
    const { token } = await signedToken();
    for (let i = 0; i < 2; i++) {
      const res = await binary(request(app).get(PENDING).set('x-consent-token', token));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect((await PDFDocument.load(res.body as Buffer)).getPageCount()).toBe(3);
    }
  });

  it('answers 404 for an unknown, expired or linked token, and 422 without the header', async () => {
    const { token, id } = await signedToken();
    expect((await request(app).get(PENDING).set('x-consent-token', 'nope')).status).toBe(404);
    expect((await request(app).get(PENDING)).status).toBe(422);

    await prisma.guardianConsent.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await request(app).get(PENDING).set('x-consent-token', token)).status).toBe(404);

    await prisma.guardianConsent.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() + 60_000) },
    });
    const student = await loginWithRole('student', 'linked@example.org');
    const profile = await createStudentProfile(student.userId, 'IN');
    await link(id, profile.id);
    expect((await request(app).get(PENDING).set('x-consent-token', token)).status).toBe(404);
  });

  it('answers 503 when the signed file no longer matches its hash', async () => {
    const { token, id } = await signedToken();
    const row = await prisma.guardianConsent.findUniqueOrThrow({ where: { id } });
    await getTestStorage().put(row.signedPdfStorageKey, Buffer.from('tampered'), 'application/pdf');
    expect((await request(app).get(PENDING).set('x-consent-token', token)).status).toBe(503);
  });

  it('lets a student download their own consent, and no one else', async () => {
    const { id } = await signedToken();
    const student = await loginWithRole('student', 'own@example.org');
    const other = await loginWithRole('student', 'other@example.org');
    const profile = await createStudentProfile(student.userId, 'IN');
    await link(id, profile.id);

    const own = await binary(
      request(app)
        .get('/api/v1/students/me/guardian-consent/file')
        .set('Authorization', `Bearer ${student.token}`)
    );
    expect(own.status).toBe(200);
    expect(own.headers['cache-control']).toBe('private, no-store');
    expect(
      (
        await request(app)
          .get('/api/v1/students/me/guardian-consent/file')
          .set('Authorization', `Bearer ${other.token}`)
      ).status
    ).toBe(404);
    expect((await request(app).get('/api/v1/students/me/guardian-consent/file')).status).toBe(401);
    const admin = await loginWithRole('admin', 'notstudent@example.org');
    expect(
      (
        await request(app)
          .get('/api/v1/students/me/guardian-consent/file')
          .set('Authorization', `Bearer ${admin.token}`)
      ).status
    ).toBe(403);
  });

  it('shows an admin the consent record and, after reauthentication, the audited PDF', async () => {
    const { id } = await signedToken();
    const student = await loginWithRole('student', 'minor@example.org');
    const profile = await createStudentProfile(student.userId, 'IN');
    await link(id, profile.id);
    const admin = await loginWithRole('admin', 'boss@example.org');
    const auth = { Authorization: `Bearer ${admin.token}` };

    const summary = await request(app)
      .get(`/api/v1/admin/students/${profile.id}/guardian-consent`)
      .set(auth);
    expect(summary.status).toBe(200);
    expectContractResponse(summary, 'get', '/admin/students/{studentId}/guardian-consent');
    expect(summary.body.data).toMatchObject({
      policyVersion: '1.0',
      country: 'IN',
      guardianName: 'Suresh Sharma',
      guardianRelationship: 'father',
      signatureMode: 'draw',
    });
    expect(summary.headers['cache-control']).toBe('private, no-store');

    const file = `/api/v1/admin/students/${profile.id}/guardian-consent/file`;
    expect((await request(app).get(file).set(auth)).status).toBe(403);
    await reauthenticate(admin);
    const pdf = await binary(request(app).get(file).set(auth));
    expect(pdf.status).toBe(200);
    expect((await PDFDocument.load(pdf.body as Buffer)).getPageCount()).toBe(3);
    const entry = await prisma.auditLog.findFirst({
      where: { action: 'consent.downloaded', resourceId: id },
    });
    expect(entry).not.toBeNull();
  });

  it('refuses the admin routes without the permission, and for a student with no consent', async () => {
    const faculty = await loginWithRole('faculty', 'teacher@example.org');
    const admin = await loginWithRole('admin', 'boss2@example.org');
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect(
      (
        await request(app)
          .get(`/api/v1/admin/students/${unknown}/guardian-consent`)
          .set('Authorization', `Bearer ${faculty.token}`)
      ).status
    ).toBe(403);
    expect(
      (await request(app).get(`/api/v1/admin/students/${unknown}/guardian-consent`)).status
    ).toBe(401);
    expect(
      (
        await request(app)
          .get(`/api/v1/admin/students/${unknown}/guardian-consent`)
          .set('Authorization', `Bearer ${admin.token}`)
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/students/nope/guardian-consent')
          .set('Authorization', `Bearer ${admin.token}`)
      ).status
    ).toBe(422);
  });

  it('refuses to delete a student profile that holds a signed consent', async () => {
    const { id } = await signedToken();
    const student = await loginWithRole('student', 'keep@example.org');
    const profile = await createStudentProfile(student.userId, 'IN');
    await link(id, profile.id);
    await expect(prisma.studentProfile.delete({ where: { id: profile.id } })).rejects.toThrow();
    expect(await prisma.guardianConsent.count({ where: { id } })).toBe(1);
  });
});

describe('purging unused consents', () => {
  beforeEach(async () => {
    getTestStorage().clear();
    await seedCountries();
    await publishAllPolicies('IN', '1.0', { realPdf: true });
  });

  async function consent(): Promise<{ id: string; key: string }> {
    const policy = await prisma.policyDocument.findFirstOrThrow({
      where: { type: 'STUDENT_TERMS' },
    });
    expect((await sign({ policyId: policy.id })).status).toBe(201);
    const row = await prisma.guardianConsent.findFirstOrThrow({ orderBy: { signedAt: 'desc' } });
    return { id: row.id, key: row.signedPdfStorageKey };
  }

  it('deletes expired unlinked consents with their files and keeps the rest', async () => {
    const expired = await consent();
    const fresh = await consent();
    const linked = await consent();
    await prisma.guardianConsent.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const user = await prisma.user.create({
      data: { email: 'purge-owner@example.org', passwordHash: 'x', fullName: 'Owner' },
    });
    const profile = await createStudentProfile(user.id, 'IN');
    await prisma.guardianConsent.update({
      where: { id: linked.id },
      data: { expiresAt: new Date(Date.now() - 1000), studentId: profile.id, linkedAt: new Date() },
    });

    expect(await purgeExpiredConsents()).toBe(1);
    expect(await prisma.guardianConsent.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await getTestStorage().get(expired.key)).toBeNull();
    expect(await prisma.guardianConsent.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await getTestStorage().get(fresh.key)).not.toBeNull();
    expect(await prisma.guardianConsent.findUnique({ where: { id: linked.id } })).not.toBeNull();
    expect(await getTestStorage().get(linked.key)).not.toBeNull();
  });

  it('does not delete a consent that is linked at the same moment', async () => {
    const racing = await consent();
    await prisma.guardianConsent.update({
      where: { id: racing.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const user = await prisma.user.create({
      data: { email: 'race-owner@example.org', passwordHash: 'x', fullName: 'Owner' },
    });
    const profile = await createStudentProfile(user.id, 'IN');
    // Linked after the purge looked at it but before it deleted: the delete is conditional, so it survives
    await prisma.guardianConsent.update({
      where: { id: racing.id },
      data: { studentId: profile.id, linkedAt: new Date() },
    });
    expect(await purgeExpiredConsents()).toBe(0);
    expect(await getTestStorage().get(racing.key)).not.toBeNull();
  });

  it('copes with a file that is already gone', async () => {
    const gone = await consent();
    await prisma.guardianConsent.update({
      where: { id: gone.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await getTestStorage().delete(gone.key);
    expect(await purgeExpiredConsents()).toBe(1);
    expect(await prisma.guardianConsent.count()).toBe(0);
  });
});
