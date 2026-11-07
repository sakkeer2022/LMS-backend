import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { expectContractResponse } from '../helpers/contract.js';
import { latestOtp } from '../helpers/email.js';
import { publishAllPolicies } from '../helpers/policies.js';
import { strokePng } from '../helpers/pdf.js';
import { seedCountries, seedReferralSources } from '../helpers/regions.js';
import {
  allowLevels,
  createLookups,
  createOffering,
  createTreeNode,
} from '../helpers/category-tree.js';
import { prisma } from '@infrastructure/database/index.js';
import { getTestOutbox } from '@infrastructure/email/index.js';
import { getTestStorage } from '@infrastructure/storage/index.js';
import { getStudent } from '@modules/students/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';

const REGISTER = '/api/v1/auth/register';

async function post(path: string, body: unknown, fields?: Record<string, string>) {
  const { csrfToken, csrfCookie } = await getCsrfData();
  const call = request(app).post(path).set('Cookie', csrfCookie).set('x-csrf-token', csrfToken);
  if (!fields) return call.send(body as object);
  for (const [key, value] of Object.entries(fields)) call.field(key, value);
  return call.attach('signature', await strokePng(), {
    filename: 'signature.png',
    contentType: 'image/png',
  });
}

/** The email token a student gets after entering the emailed code. */
async function verifiedEmailToken(email: string): Promise<string> {
  const asked = await post('/api/v1/auth/registration/email-otp/requests', { email });
  await prisma.emailChallenge.updateMany({
    where: { email },
    data: { resendCooldownUntil: new Date(0) },
  });
  const verified = await post('/api/v1/auth/registration/email-otp/verify', {
    challengeId: asked.body.data.challengeId,
    otp: latestOtp(email),
  });
  return verified.body.data.emailVerificationToken as string;
}

const dobFor = (years: number): string => {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate()))
    .toISOString()
    .slice(0, 10);
};

describe('POST /auth/register (student)', () => {
  let policies: Awaited<ReturnType<typeof publishAllPolicies>>;
  let school: { id: string; boardId: string; levelId: string; curriculumIds: string[] };
  let guitar: { id: string; curriculumId: string };
  let languageId: string;

  beforeEach(async () => {
    getTestOutbox().clear();
    getTestStorage().clear();
    await seedCountries();
    await seedReferralSources();
    await seedRbac(prisma);
    policies = await publishAllPolicies('IN', '1.0', { realPdf: true });
    const root = await createTreeNode(null, { code: 'test-root' });
    const lookups = await createLookups();
    const schoolLeaf = await createTreeNode(root, {
      isBookable: true,
      requiresBoard: true,
      requiresLevel: true,
    });
    await allowLevels(schoolLeaf.id, [lookups.level.id]);
    const physics = await createOffering({
      categoryId: schoolLeaf.id,
      boardId: lookups.board.id,
      levelId: lookups.level.id,
      subjectId: lookups.subject.id,
    });
    const chemistry = await createOffering({
      categoryId: schoolLeaf.id,
      boardId: lookups.board.id,
      levelId: lookups.level.id,
      subjectId: lookups.subject2.id,
    });
    school = {
      id: schoolLeaf.id,
      boardId: lookups.board.id,
      levelId: lookups.level.id,
      curriculumIds: [physics.id, chemistry.id],
    };
    const guitarLeaf = await createTreeNode(root, { isBookable: true });
    const guitarOffering = await createOffering({
      categoryId: guitarLeaf.id,
      subjectId: lookups.subject.id,
    });
    guitar = { id: guitarLeaf.id, curriculumId: guitarOffering.id };
    languageId = (
      await prisma.teachingLanguage.create({
        data: { code: 'en', name: 'English', languageCodes: ['en'] },
      })
    ).id;
  });

  async function payload(overrides: Record<string, unknown> = {}) {
    return {
      emailVerificationToken: await verifiedEmailToken('rahul@example.org'),
      fullName: 'Rahul Nair',
      dateOfBirth: dobFor(21),
      mobileNumber: '+919876543210',
      password: 'Password1',
      timezone: 'Asia/Kolkata',
      learningProfile: { curriculumIds: school.curriculumIds },
      acceptedPolicyIds: [policies.TERMS_OF_USE.id, policies.PRIVACY_POLICY.id],
      ...overrides,
    };
  }

  it('creates the student, profile, subjects and acceptances in one go, without logging them in', async () => {
    const res = await post(REGISTER, await payload());
    expect(res.status).toBe(201);
    expectContractResponse(res, 'post', '/auth/register');
    expect(res.headers['set-cookie']).toBeUndefined();

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: res.body.data.userId },
      include: {
        roles: { include: { role: true } },
        studentProfile: { include: { subjects: true } },
        policyAcceptances: true,
      },
    });
    expect(user.email).toBe('rahul@example.org');
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.passwordHash).not.toContain('Password1');
    expect(user.roles.map((r) => r.role.name)).toEqual(['student']);
    expect(user.studentProfile?.country).toBe('IN');
    expect(user.studentProfile?.subjects).toHaveLength(2);
    expect(user.policyAcceptances).toHaveLength(2);
    expect(user.policyAcceptances[0]?.ipAddress).toBeTruthy();
    const audit = await prisma.auditLog.findFirst({ where: { action: 'student.registered' } });
    expect(audit?.actorId).toBe(user.id);
  });

  it('registers a student who mixes academic and non-academic offerings, with no language', async () => {
    const res = await post(
      REGISTER,
      await payload({
        learningProfile: { curriculumIds: [...school.curriculumIds, guitar.curriculumId] },
      })
    );
    expect(res.status).toBe(201);
    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: res.body.data.userId },
    });
    expect(profile.teachingLanguageId).toBeNull();
    const { interests } = (await getStudent(profile.id)).learningProfile;
    expect(interests).toHaveLength(3);
    // The leaf that needs no board or level reads back with neither
    expect(interests.filter((i) => i.board === null && i.level === null)).toHaveLength(1);
  });

  it('keeps an optional teaching language when one is sent', async () => {
    const res = await post(
      REGISTER,
      await payload({
        learningProfile: { curriculumIds: school.curriculumIds, teachingLanguageId: languageId },
      })
    );
    expect(res.status).toBe(201);
    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: res.body.data.userId },
    });
    expect(profile.teachingLanguageId).toBe(languageId);
  });

  it('links the guardian consent for a student under 18 and copies the guardian', async () => {
    const signed = await post('/api/v1/consent/guardian-signatures', null, {
      policyId: policies.STUDENT_TERMS.id,
      studentFullName: 'Rahul Nair',
      studentDateOfBirth: dobFor(15),
      signatureMode: 'draw',
    });
    expect(signed.status).toBe(201);
    const res = await post(
      REGISTER,
      await payload({
        dateOfBirth: dobFor(15),
        consentToken: signed.body.data.consentToken,
        guardian: {
          fullName: 'Meera Nair',
          relationship: 'mother',
          mobileNumber: '+919812345678',
          email: 'Meera@Example.org',
          receivesReportsAndReceipts: true,
        },
        acceptedPolicyIds: [
          policies.TERMS_OF_USE.id,
          policies.PRIVACY_POLICY.id,
          policies.CHILD_SAFETY_POLICY.id,
        ],
      })
    );
    expect(res.status).toBe(201);
    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: res.body.data.userId },
    });
    expect(profile.guardianEmail).toBe('meera@example.org');
    const consent = await prisma.guardianConsent.findFirstOrThrow({
      where: { studentId: profile.id },
    });
    expect(consent.linkedAt).not.toBeNull();
    expect(consent.guardianName).toBe('Meera Nair');
    expect(consent.guardianRelationship).toBe('MOTHER');
  });

  it('refuses a student under 18 without a guardian signature, and keeps the email token usable', async () => {
    const body = await payload({ dateOfBirth: dobFor(15) });
    const res = await post(REGISTER, body);
    expect(res.status).toBe(422);
    const retry = await post(REGISTER, { ...body, dateOfBirth: dobFor(21) });
    expect(retry.status).toBe(201);
  });

  it('refuses a guardian signature on an adult', async () => {
    const res = await post(REGISTER, await payload({ consentToken: 'whatever' }));
    expect(res.status).toBe(422);
    expect(await prisma.user.count()).toBe(0);
  });

  it('returns 409 for an email that already has an account', async () => {
    const body = await payload();
    await prisma.user.create({
      data: { email: 'rahul@example.org', passwordHash: 'x', fullName: 'Old' },
    });
    const res = await post(REGISTER, body);
    expect(res.status).toBe(409);
  });

  it('stores the optional referral and education answers and shows them to the admin', async () => {
    const res = await post(
      REGISTER,
      await payload({
        referral: { sourceCode: 'other', other: 'A poster at my tuition centre' },
        education: { level: 'school', institutionName: 'Govt HSS Kochi', detail: 'Class 10' },
      })
    );
    expect(res.status).toBe(201);
    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: res.body.data.userId },
    });
    expect(profile.referralSourceCode).toBe('other');
    expect(profile.educationLevel).toBe('SCHOOL');
    const detail = await getStudent(profile.id);
    expect(detail.referral).toEqual({
      code: 'other',
      name: 'Other',
      other: 'A poster at my tuition centre',
    });
    expect(detail.education).toEqual({
      level: 'school',
      institutionName: 'Govt HSS Kochi',
      detail: 'Class 10',
    });
  });

  it('registers without either answer and reads them back as null', async () => {
    const res = await post(REGISTER, await payload());
    expect(res.status).toBe(201);
    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { userId: res.body.data.userId },
    });
    const detail = await getStudent(profile.id);
    expect(detail.referral).toBeNull();
    expect(detail.education).toBeNull();
  });

  it('accepts a referral source alone, and education with only one field', async () => {
    const res = await post(
      REGISTER,
      await payload({
        referral: { sourceCode: 'instagram' },
        education: { institutionName: 'IIT Madras' },
      })
    );
    expect(res.status).toBe(201);
  });

  it('refuses an unknown referral source, own words without Other, and empty education', async () => {
    for (const overrides of [
      { referral: { sourceCode: 'billboard' } },
      { referral: { sourceCode: 'instagram', other: 'my cousin' } },
      { education: {} },
      { education: { level: 'kindergarten' } },
    ]) {
      const res = await post(REGISTER, await payload(overrides));
      expect(res.status).toBe(422);
    }
  });

  it('lists the active referral sources without signing in', async () => {
    await prisma.referralSource.update({ where: { code: 'news_blog' }, data: { isActive: false } });
    const res = await request(app).get('/api/v1/auth/registration/referral-sources');
    expect(res.status).toBe(200);
    expectContractResponse(res, 'get', '/auth/registration/referral-sources');
    const codes = (res.body.data as { code: string }[]).map((row) => row.code);
    expect(codes).toContain('instagram');
    expect(codes).not.toContain('news_blog');
    expect(codes.at(-1)).toBe('other');
  });

  it('refuses unknown fields such as role', async () => {
    const res = await post(REGISTER, await payload({ role: 'super_admin' }));
    expect(res.status).toBe(422);
  });

  it('refuses a policy set that is not the current required one', async () => {
    const res = await post(
      REGISTER,
      await payload({ acceptedPolicyIds: [policies.TERMS_OF_USE.id, policies.STUDENT_TERMS.id] })
    );
    expect(res.status).toBe(422);
  });

  it('refuses an offering that does not exist or has been switched off', async () => {
    const unknown = await post(
      REGISTER,
      await payload({
        learningProfile: { curriculumIds: [randomUUID()] },
      })
    );
    expect(unknown.status).toBe(422);
    await prisma.curriculum.update({
      where: { id: guitar.curriculumId },
      data: { isActive: false },
    });
    const off = await post(
      REGISTER,
      await payload({
        learningProfile: { curriculumIds: [...school.curriculumIds, guitar.curriculumId] },
      })
    );
    expect(off.status).toBe(422);
  });

  it('uses an email token only once', async () => {
    const body = await payload();
    expect((await post(REGISTER, body)).status).toBe(201);
    await prisma.user.deleteMany();
    expect((await post(REGISTER, body)).status).toBe(422);
  });
});
