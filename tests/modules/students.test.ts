import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { expectContractResponse } from '../helpers/contract.js';
import { publishAllPolicies } from '../helpers/policies.js';
import { seedCountries } from '../helpers/regions.js';
import { createStudentProfile } from '../helpers/students.js';
import { loginWithRole, type LoggedInUser } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';
import { getTestStorage } from '@infrastructure/storage/index.js';
import { clearRegionCache } from '@modules/regions/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';

const LIST = '/api/v1/admin/students';

function dobFor(years: number, days = 0): string {
  const today = new Date();
  return new Date(
    Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate() + days)
  )
    .toISOString()
    .slice(0, 10);
}

interface Seeded {
  minorSigned: string;
  minorUnsigned: string;
  adultIndia: string;
  minorUae: string;
  adultUae: string;
  nineteenSingapore: string;
  turnsEighteenToday: string;
  turnedEighteenYesterday: string;
}

async function student(
  name: string,
  email: string,
  country: string,
  dob: string,
  mobile?: string
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email,
      fullName: name,
      passwordHash: 'x',
      mobileNumber: mobile ?? null,
      emailVerifiedAt: new Date(),
    },
  });
  return (await createStudentProfile(user.id, country, dob)).id;
}

async function seed(): Promise<Seeded> {
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
  clearRegionCache();
  const policies = await publishAllPolicies('IN', '1.0', { realPdf: true });

  const ids: Seeded = {
    minorSigned: await student(
      'Ananya Sharma',
      'ananya@example.org',
      'IN',
      dobFor(14),
      '+919845012345'
    ),
    minorUnsigned: await student(
      'Rohan Mehta',
      'rohan@example.org',
      'IN',
      dobFor(15),
      '+919845099999'
    ),
    adultIndia: await student('Priya Nair', 'priya@example.org', 'IN', dobFor(25), '+919811100000'),
    minorUae: await student('Layla Hassan', 'layla@example.org', 'AE', dobFor(16), '+971501234567'),
    adultUae: await student('Omar Khalid', 'omar@example.org', 'AE', dobFor(30), '+971507654321'),
    nineteenSingapore: await student('Wei Tan', 'wei@example.org', 'SG', dobFor(19), '+6591234567'),
    turnsEighteenToday: await student('Today Eighteen', 'today@example.org', 'IN', dobFor(18)),
    turnedEighteenYesterday: await student(
      'Day Before Eighteen',
      'before@example.org',
      'IN',
      dobFor(18, 1)
    ),
  };
  await prisma.studentProfile.update({
    where: { id: ids.minorSigned },
    data: {
      guardianName: 'Suresh Sharma',
      guardianRelationship: 'FATHER',
      guardianMobileNumber: '+919886044120',
      guardianEmail: 'suresh@example.org',
      guardianReceivesReports: true,
    },
  });
  await prisma.guardianConsent.create({
    data: {
      studentId: ids.minorSigned,
      policyId: policies.STUDENT_TERMS.id,
      tokenHash: 'a'.repeat(64),
      studentFullName: 'Ananya Sharma',
      studentDateOfBirth: new Date(`${dobFor(14)}T00:00:00Z`),
      signatureMode: 'DRAW',
      signedPdfStorageKey: 'consents/seed.pdf',
      signedPdfSha256: 'b'.repeat(64),
      ipAddress: '203.0.113.7',
      expiresAt: new Date(Date.now() + 3_600_000),
      linkedAt: new Date(),
      guardianName: 'Suresh Sharma',
      guardianRelationship: 'FATHER',
    },
  });
  return ids;
}

describe('admin students', () => {
  let admin: LoggedInUser;
  let ids: Seeded;

  const get = (path: string, token = admin.token): request.Test =>
    request(app).get(path).set('Authorization', `Bearer ${token}`);
  const names = (res: request.Response): string[] =>
    (res.body.data as { fullName: string }[]).map((s) => s.fullName).sort();

  beforeEach(async () => {
    getTestStorage().clear();
    await seedCountries();
    await seedRbac(prisma);
    admin = await loginWithRole('admin', 'registrar@example.org');
    ids = await seed();
  });

  it('lists every student, newest first, with age, minor flag, guardian and consent status', async () => {
    const res = await get(LIST);
    expect(res.status).toBe(200);
    expectContractResponse(res, 'get', '/admin/students');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.meta).toMatchObject({ page: 1, total: 8 });
    expect(res.body.data[0].fullName).toBe('Day Before Eighteen');

    const signed = res.body.data.find((s: { id: string }) => s.id === ids.minorSigned);
    expect(signed).toMatchObject({
      age: 14,
      isMinor: true,
      consentStatus: 'signed',
      country: 'IN',
      guardian: {
        fullName: 'Suresh Sharma',
        relationship: 'father',
        receivesReportsAndReceipts: true,
      },
    });
    const unsigned = res.body.data.find((s: { id: string }) => s.id === ids.minorUnsigned);
    expect(unsigned).toMatchObject({ isMinor: true, consentStatus: 'missing', guardian: null });
    const adult = res.body.data.find((s: { id: string }) => s.id === ids.adultIndia);
    expect(adult).toMatchObject({ age: 25, isMinor: false, consentStatus: 'not_required' });
  });

  it("reads the minor rule from each student's country: 18 in India and the UAE, 21 in a country set to 21", async () => {
    const res = await get(`${LIST}?minor=true`);
    expect(names(res)).toEqual(
      ['Ananya Sharma', 'Day Before Eighteen', 'Layla Hassan', 'Rohan Mehta', 'Wei Tan'].sort()
    );
    const adults = await get(`${LIST}?minor=false`);
    expect(names(adults)).toEqual(['Omar Khalid', 'Priya Nair', 'Today Eighteen']);
    // 19 years old: a minor in Singapore (21), an adult if the same age were in India (18)
    const wei = res.body.data.find((s: { id: string }) => s.id === ids.nineteenSingapore);
    expect(wei).toMatchObject({ age: 19, isMinor: true, consentStatus: 'missing' });
  });

  it('is a minor the day before the 18th birthday and not on it, in both countries', async () => {
    const res = await get(`${LIST}?country=IN`);
    const byId = (id: string): { isMinor: boolean; age: number } =>
      res.body.data.find((s: { id: string }) => s.id === id);
    expect(byId(ids.turnsEighteenToday)).toMatchObject({ age: 18, isMinor: false });
    expect(byId(ids.turnedEighteenYesterday)).toMatchObject({ age: 17, isMinor: true });
  });

  it('filters by consent status', async () => {
    expect(names(await get(`${LIST}?consent=signed`))).toEqual(['Ananya Sharma']);
    expect(names(await get(`${LIST}?consent=missing`))).toEqual(
      ['Day Before Eighteen', 'Layla Hassan', 'Rohan Mehta', 'Wei Tan'].sort()
    );
    expect(names(await get(`${LIST}?consent=not_required`))).toEqual([
      'Omar Khalid',
      'Priya Nair',
      'Today Eighteen',
    ]);
  });

  it('filters by country and searches the name, email and mobile number', async () => {
    expect(names(await get(`${LIST}?country=ae`))).toEqual(['Layla Hassan', 'Omar Khalid']);
    expect(names(await get(`${LIST}?q=sharma`))).toEqual(['Ananya Sharma']);
    expect(names(await get(`${LIST}?q=PRIYA@EXAMPLE`))).toEqual(['Priya Nair']);
    expect(names(await get(`${LIST}?q=98450`))).toEqual(['Ananya Sharma', 'Rohan Mehta']);
    expect(names(await get(`${LIST}?q=nobody-at-all`))).toEqual([]);
    expect(names(await get(`${LIST}?country=IN&minor=true&consent=missing`))).toEqual([
      'Day Before Eighteen',
      'Rohan Mehta',
    ]);
  });

  it('paginates', async () => {
    const first = await get(`${LIST}?limit=3&page=1`);
    const last = await get(`${LIST}?limit=3&page=3`);
    expect(first.body.data).toHaveLength(3);
    expect(first.body.meta).toMatchObject({ page: 1, limit: 3, total: 8, totalPages: 3 });
    expect(last.body.data).toHaveLength(2);
  });

  it('shows one student with the learning profile, guardian and the consent record', async () => {
    const res = await get(`${LIST}/${ids.minorSigned}`);
    expect(res.status).toBe(200);
    expectContractResponse(res, 'get', '/admin/students/{studentId}');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.data).toMatchObject({
      fullName: 'Ananya Sharma',
      consentStatus: 'signed',
      learningProfile: { teachingLanguage: null, interests: [] },
      consent: {
        policyVersion: '1.0',
        country: 'IN',
        guardianName: 'Suresh Sharma',
        guardianRelationship: 'father',
      },
    });
    const adult = await get(`${LIST}/${ids.adultIndia}`);
    expect(adult.body.data.consent).toBeNull();
  });

  it('answers 404 for an unknown student and 422 for a malformed id or filter', async () => {
    expect((await get(`${LIST}/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await get(`${LIST}/nope`)).status).toBe(422);
    expect((await get(`${LIST}?consent=maybe`)).status).toBe(422);
    expect((await get(`${LIST}?minor=perhaps`)).status).toBe(422);
    expect((await get(`${LIST}?country=INDIA`)).status).toBe(422);
    expect((await get(`${LIST}?limit=1000`)).status).toBe(422);
  });

  it('needs a session and the student.read permission', async () => {
    const faculty = await loginWithRole('faculty', 'teacher@example.org');
    const learner = await loginWithRole('student', 'learner@example.org');
    expect((await request(app).get(LIST)).status).toBe(401);
    expect((await get(LIST, faculty.token)).status).toBe(403);
    expect((await get(LIST, learner.token)).status).toBe(403);
    expect((await get(`${LIST}/${ids.minorSigned}`, faculty.token)).status).toBe(403);
  });
});
