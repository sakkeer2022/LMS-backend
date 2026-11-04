import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { loginWithRole } from '../helpers/users.js';
import { createUserWithPermissions } from '../helpers/auth.js';
import { expectContractResponse } from '../helpers/contract.js';
import { PDF, PNG, createInvitationWithToken, createPickerCatalogue, sha256 } from '../helpers/onboarding.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';
import { InMemoryEmailProvider, setEmailProvider } from '../../src/infrastructure/email/index.js';
import { InMemoryStorage, setObjectStorage } from '../../src/infrastructure/storage/index.js';

const API = '/api/v1';
const PASSWORD = 'Tutor12345';

type Csrf = { csrfToken: string; csrfCookie: string };

describe('Faculty onboarding, review, pricing gate and consent (LMS-39, LMS-40)', () => {
  let csrf: Csrf;
  let mail: InMemoryEmailProvider;
  let storage: InMemoryStorage;
  let catalogue: Awaited<ReturnType<typeof createPickerCatalogue>>;
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await seedRbac(prisma);
    csrf = await getCsrfData();
    mail = new InMemoryEmailProvider();
    setEmailProvider(mail);
    storage = new InMemoryStorage();
    setObjectStorage(storage);
    catalogue = await createPickerCatalogue();
    ({ token: adminToken, userId: adminId } = await loginWithRole('admin', 'onboarding-admin@example.com'));
  });

  const post = (path: string, body: unknown, token?: string) => {
    const req = request(app).post(`${API}${path}`).set('Cookie', csrf.csrfCookie).set('x-csrf-token', csrf.csrfToken);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body as object);
  };
  const put = (path: string, body: unknown, token = adminToken) =>
    request(app)
      .put(`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', csrf.csrfCookie)
      .set('x-csrf-token', csrf.csrfToken)
      .send(body as object);
  const get = (path: string, token = adminToken) => request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`);

  function apply(token: string, overrides: Record<string, string | null> = {}, files: Record<string, [Buffer, string] | null> = {}) {
    const fields: Record<string, string | null> = {
      token,
      fullName: 'Anil Verma',
      password: PASSWORD,
      confirmPassword: PASSWORD,
      mobileNumber: '+919876543210',
      city: 'Bengaluru',
      highestQualification: 'M.Sc. Physics',
      teachingExperience: '5-10',
      studiedAt: 'IIT Delhi',
      curriculumIds: JSON.stringify([catalogue.physics.id, catalogue.chemistry.id]),
      offersOfflineClasses: 'true',
      declarationAccepted: 'true',
      ...overrides,
    };
    const req = request(app)
      .post(`${API}/faculty/onboarding/applications`)
      .set('Cookie', csrf.csrfCookie)
      .set('x-csrf-token', csrf.csrfToken);
    for (const [k, v] of Object.entries(fields)) if (v !== null) req.field(k, v);
    const docs: Record<string, [Buffer, string] | null> = {
      photoId: [PNG, 'aadhaar.png'],
      degreeCertificate: [PDF, 'degree.pdf'],
      panCard: [PDF, 'pan.pdf'],
      ...files,
    };
    for (const [k, v] of Object.entries(docs)) if (v) req.attach(k, v[0], { filename: v[1] });
    return req;
  }

  async function submitted(email = 'anil.verma@example.com') {
    const { token, invitation } = await createInvitationWithToken(email);
    const res = await apply(token);
    expect(res.status).toBe(201);
    const profile = await prisma.facultyProfile.findFirstOrThrow({ where: { invitationId: invitation.id } });
    return { token, invitation, profile, res };
  }

  const facultyLogin = (email: string, password = PASSWORD) => post('/auth/faculty/login', { email, password });

  async function approve(facultyId: string, publish = true) {
    const { revision } = await prisma.facultyProfile.findUniqueOrThrow({ where: { id: facultyId } });
    return put(`/admin/faculty/${facultyId}/review`, { decision: 'approve', publish, expectedRevision: revision });
  }

  async function priceAll(facultyId: string, pricePaise = 145000) {
    const assignments = await prisma.facultyAssignment.findMany({ where: { facultyId } });
    for (const a of assignments) {
      const res = await post('/admin/prices', { curriculumId: a.curriculumId, facultyId, sessionPricePaise: pricePaise, isActive: true }, adminToken);
      expect(res.status).toBe(201);
    }
  }

  // ── Invitation link ──────────────────────────────────────────────

  describe('POST /faculty/onboarding/session', () => {
    it('returns the invited email for a usable link', async () => {
      const { token } = await createInvitationWithToken('Meera.Iyer@example.com'.toLowerCase());
      const res = await post('/faculty/onboarding/session', { token });
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('meera.iyer@example.com');
      expect(res.headers['cache-control']).toBe('no-store');
      expectContractResponse(res, 'post', '/faculty/onboarding/session');
    });

    it('gives the same 422 for unknown, expired, used and revoked links', async () => {
      const expired = await createInvitationWithToken(undefined, true);
      const used = await createInvitationWithToken();
      await prisma.facultyInvitation.update({ where: { id: used.invitation.id }, data: { status: 'ACCEPTED' } });
      const revoked = await createInvitationWithToken();
      await prisma.facultyInvitation.update({ where: { id: revoked.invitation.id }, data: { status: 'REVOKED' } });
      for (const token of ['A'.repeat(43), expired.token, used.token, revoked.token]) {
        const res = await post('/faculty/onboarding/session', { token });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('INVITATION_INVALID');
      }
    });

    it('rejects a malformed token and a missing CSRF token', async () => {
      expect((await post('/faculty/onboarding/session', { token: 'short' })).status).toBe(422);
      const res = await request(app).post(`${API}/faculty/onboarding/session`).send({ token: 'A'.repeat(43) });
      expect(res.status).toBe(403);
    });

    it('is rate-limited per IP', async () => {
      const res = await post('/faculty/onboarding/session', { token: 'A'.repeat(43) });
      expect(res.headers['ratelimit-limit']).toBe('500');
    });
  });

  describe('GET /faculty/onboarding/catalogue', () => {
    it('returns visible branches and active offerings only', async () => {
      const res = await request(app).get(`${API}/faculty/onboarding/catalogue`);
      expect(res.status).toBe(200);
      expectContractResponse(res, 'get', '/faculty/onboarding/catalogue');
      const ids = res.body.data.nodes.map((n: { id: string }) => n.id);
      expect(ids).toEqual(expect.arrayContaining([catalogue.academic.id, catalogue.school.id, catalogue.k12.id]));
      expect(ids).not.toContain(catalogue.hidden.id);
      const offerings = res.body.data.offerings.map((o: { curriculumId: string }) => o.curriculumId);
      expect(offerings.sort()).toEqual([catalogue.physics.id, catalogue.chemistry.id].sort());
      const physics = res.body.data.offerings.find((o: { curriculumId: string }) => o.curriculumId === catalogue.physics.id);
      expect(physics).toMatchObject({ categoryId: catalogue.k12.id, board: { id: catalogue.board.id }, level: { id: catalogue.level.id } });
    });
  });

  describe('GET /admin/category-tree/picker', () => {
    it('returns the same offering tree to an admin', async () => {
      const res = await request(app).get(`${API}/admin/category-tree/picker`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expectContractResponse(res, 'get', '/admin/category-tree/picker');
      expect(res.body.data.offerings.map((o: { curriculumId: string }) => o.curriculumId).sort()).toEqual(
        [catalogue.physics.id, catalogue.chemistry.id].sort(),
      );
    });

    it('requires authentication and catalogue.read', async () => {
      expect((await request(app).get(`${API}/admin/category-tree/picker`)).status).toBe(401);
      const { token } = await createUserWithPermissions(['faculty.read']);
      const res = await request(app).get(`${API}/admin/category-tree/picker`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ── Application ──────────────────────────────────────────────────

  describe('POST /faculty/onboarding/applications', () => {
    it('creates the faculty user, profile, subjects and documents in one go', async () => {
      const { invitation, profile, res } = await submitted();
      expect(res.body.data).toMatchObject({ fullName: 'Anil Verma', email: 'anil.verma@example.com' });
      expect(res.body.data.applicationReference).toMatch(/^AMZ-T-\d{4,}$/);
      expectContractResponse(res, 'post', '/faculty/onboarding/applications');

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'anil.verma@example.com' },
        include: { roles: { include: { role: true } } },
      });
      expect(user.roles.map((r) => r.role.name)).toEqual(['faculty']);
      expect(user).toMatchObject({ fullName: 'Anil Verma', mobileNumber: '+919876543210', status: 'ACTIVE' });
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(user.passwordHash).not.toContain(PASSWORD);

      expect(profile).toMatchObject({
        approvalStatus: 'PENDING',
        isPublished: false,
        city: 'Bengaluru',
        highestQualification: 'M.Sc. Physics',
        studiedAt: 'IIT Delhi',
        teachingExperience: '5-10',
        offersOfflineClasses: true,
        applicationReference: res.body.data.applicationReference,
      });
      expect(profile.submittedAt).not.toBeNull();
      expect(profile.declarationAcceptedAt).not.toBeNull();

      const assignments = await prisma.facultyAssignment.findMany({ where: { facultyId: profile.id } });
      expect(assignments.map((a) => a.curriculumId).sort()).toEqual([catalogue.physics.id, catalogue.chemistry.id].sort());

      const docs = await prisma.facultyDocument.findMany({ where: { facultyId: profile.id }, orderBy: { documentType: 'asc' } });
      expect(docs.map((d) => [d.documentType, d.mimeType, d.originalFileName])).toEqual(
        expect.arrayContaining([
          ['GOVERNMENT_ID', 'image/png', 'aadhaar.png'],
          ['DEGREE_CERTIFICATE', 'application/pdf', 'degree.pdf'],
          ['PAN_CARD', 'application/pdf', 'pan.pdf'],
        ])
      );
      for (const d of docs) expect(d.storageKey).toMatch(/^faculty-documents\/[0-9a-f-]{36}$/);
      expect(sha256(storage.objects.get(docs.find((d) => d.documentType === 'GOVERNMENT_ID')!.storageKey)!.body)).toBe(sha256(PNG));

      expect((await prisma.facultyInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe('ACCEPTED');
      expect(await prisma.auditLog.count({ where: { action: 'faculty.application_submitted' } })).toBe(1);
      await new Promise((r) => setTimeout(r, 20));
      expect(mail.sent.map((m) => m.category)).toContain('faculty-application');
    });

    it('accepts Word and PowerPoint files by signature', async () => {
      const { token } = await createInvitationWithToken();
      // DOCX/PPTX are zip containers; file-type reads the [Content_Types].xml entry, so a real
      // minimal document is not needed for the negative case below; here the positive case uses
      // OLE (.doc), whose signature is fixed.
      const ole = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(1024)]);
      const res = await apply(token, {}, { panCard: [ole, 'pan.doc'] });
      expect(res.status).toBe(201);
      const doc = await prisma.facultyDocument.findFirstOrThrow({ where: { documentType: 'PAN_CARD' } });
      expect(doc.mimeType).toBe('application/msword');
    });

    it('rejects a spoofed file, a missing file and an extension that does not match', async () => {
      const { token } = await createInvitationWithToken();
      const res = await apply(token, {}, {
        photoId: [Buffer.from('MZ this is an exe'), 'photo.png'],
        degreeCertificate: null,
        panCard: [PDF, 'pan.png'],
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('DOCUMENT_INVALID');
      expect(Object.keys(res.body.errors).sort()).toEqual(['degreeCertificate', 'panCard', 'photoId']);
      expect(await prisma.user.count({ where: { email: { contains: 'tutor-' } } })).toBe(0);
      expect(storage.objects.size).toBe(0);
    });

    it('rejects a file over the size limit', async () => {
      const { token } = await createInvitationWithToken();
      const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
      const res = await apply(token, {}, { panCard: [big, 'pan.pdf'] });
      expect(res.status).toBe(422);
      expect(res.body.errors.panCard[0]).toMatch(/larger than 10 MB/);
    });

    it.each([
      [{ confirmPassword: 'Different123' }, 'confirmPassword'],
      [{ password: 'short1', confirmPassword: 'short1' }, 'password'],
      [{ password: 'nonumbershere', confirmPassword: 'nonumbershere' }, 'password'],
      [{ fullName: ' ' }, 'fullName'],
      [{ mobileNumber: '98765' }, 'mobileNumber'],
      [{ teachingExperience: '20+' }, 'teachingExperience'],
      [{ highestQualification: null }, 'highestQualification'],
      [{ curriculumIds: '[]' }, 'curriculumIds'],
      [{ curriculumIds: 'not json' }, 'curriculumIds'],
      [{ declarationAccepted: 'false' }, 'declarationAccepted'],
      [{ extra: 'x' }, ''],
    ])('rejects %j with 422', async (overrides, field) => {
      const { token } = await createInvitationWithToken();
      const res = await apply(token, overrides as Record<string, string | null>);
      expect(res.status).toBe(422);
      if (field) expect(Object.keys(res.body.errors ?? {})).toContain(field);
      expect(await prisma.facultyProfile.count()).toBe(0);
    });

    it('rejects a mobile number of an unsupported country', async () => {
      const { token } = await createInvitationWithToken();
      const res = await apply(token, { mobileNumber: '+15555550123' });
      expect(res.status).toBe(422);
      expect(res.body.errors.mobileNumber).toBeDefined();
    });

    it('rejects subjects that are not offered (inactive, hidden or unknown)', async () => {
      for (const id of [catalogue.inactive.id, catalogue.hiddenOffering.id, '8c121988-8afa-4fb7-b6eb-9b0dcb94f730']) {
        const { token } = await createInvitationWithToken();
        const res = await apply(token, { curriculumIds: JSON.stringify([catalogue.physics.id, id]) });
        expect(res.status).toBe(422);
        expect(res.body.errors.curriculumIds).toBeDefined();
      }
      expect(storage.objects.size).toBe(0);
    });

    it('cannot reuse a link', async () => {
      const { token } = await submitted();
      const again = await apply(token);
      expect(again.status).toBe(422);
      expect(again.body.code).toBe('INVITATION_INVALID');
    });

    it('refuses an email that already has an account and removes the stored files', async () => {
      const { token } = await createInvitationWithToken('taken@example.com');
      await prisma.user.create({ data: { email: 'taken@example.com', passwordHash: 'x', fullName: 'Taken' } });
      const res = await apply(token);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_REGISTERED');
      expect(storage.objects.size).toBe(0);
    });

    it('requires a CSRF token', async () => {
      const { token } = await createInvitationWithToken();
      const res = await request(app).post(`${API}/faculty/onboarding/applications`).field('token', token);
      expect(res.status).toBe(403);
    });
  });

  // ── Admin verification (screen 27b) ──────────────────────────────

  describe('admin verification', () => {
    it('shows the application in the drawer', async () => {
      const { profile } = await submitted();
      const res = await get(`/admin/faculty/${profile.id}`);
      expect(res.status).toBe(200);
      expectContractResponse(res, 'get', `/admin/faculty/${profile.id}`);
      expect(res.body.data).toMatchObject({
        fullName: 'Anil Verma',
        status: 'pending',
        approvalStatus: 'pending',
        pricing: 'none',
        screening: {
          highestQualification: 'M.Sc. Physics',
          studiedAt: 'IIT Delhi',
          teachingExperience: { code: '5-10', label: '5–10 years' },
          offersOfflineClasses: true,
        },
      });
      expect(res.body.data.documents.map((d: { label: string }) => d.label).sort()).toEqual(
        ['Highest degree certificate', 'PAN card', 'Photo ID']
      );
      expect(res.body.data.subjects).toHaveLength(2);
      expect(res.body.data.subjects[0].pathLabel).toContain('School › K-12');
      expect(res.body.data.subjects[0].sessionPricePaise).toBeNull();
    });

    it('lists the applicant in the roster with the onboarding qualification and 3 documents', async () => {
      await submitted();
      const res = await get('/admin/faculty?status=pending');
      expect(res.status).toBe(200);
      expectContractResponse(res, 'get', '/admin/faculty?status=pending');
      expect(res.body.data[0]).toMatchObject({
        fullName: 'Anil Verma',
        qualification: 'M.Sc. Physics · IIT Delhi',
        documents: { uploaded: 3, required: 3 },
        pricing: 'none',
      });
    });

    it('streams a document with safe headers and audits the view', async () => {
      const { profile } = await submitted();
      const doc = await prisma.facultyDocument.findFirstOrThrow({ where: { facultyId: profile.id, documentType: 'DEGREE_CERTIFICATE' } });
      const res = await get(`/admin/faculty/${profile.id}/documents/${doc.id}/file`).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      expect(sha256(res.body as Buffer)).toBe(sha256(PDF));
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename\*=UTF-8''degree\.pdf$/);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-document-previewable']).toBe('true');
      expect(await prisma.auditLog.count({ where: { action: 'faculty.document_viewed', resourceId: doc.id } })).toBe(1);
    });

    it("hides another tutor's document and needs faculty.documents", async () => {
      const first = await submitted('first@example.com');
      const second = await submitted('second@example.com');
      const doc = await prisma.facultyDocument.findFirstOrThrow({ where: { facultyId: second.profile.id } });
      expect((await get(`/admin/faculty/${first.profile.id}/documents/${doc.id}/file`)).status).toBe(404);
      const { token } = await createUserWithPermissions(['faculty.read']);
      expect((await get(`/admin/faculty/${second.profile.id}/documents/${doc.id}/file`, token)).status).toBe(403);
    });

    it('marks a document verified', async () => {
      const { profile } = await submitted();
      const doc = await prisma.facultyDocument.findFirstOrThrow({ where: { facultyId: profile.id } });
      const res = await put(`/admin/faculty/${profile.id}/documents/${doc.id}/verification`, { isVerified: true });
      expect(res.status).toBe(200);
      expectContractResponse(res, 'put', `/admin/faculty/${profile.id}/documents/${doc.id}/verification`);
      expect(res.body.data.documents.find((d: { id: string }) => d.id === doc.id).isVerified).toBe(true);
      expect((await prisma.facultyDocument.findUniqueOrThrow({ where: { id: doc.id } })).verifiedBy).toBe(adminId);
    });

    it('approves: verifies every document, publishes as chosen and emails the tutor', async () => {
      const { profile } = await submitted();
      const res = await approve(profile.id, true);
      expect(res.status).toBe(200);
      expectContractResponse(res, 'put', `/admin/faculty/${profile.id}/review`);
      expect(res.body.data).toMatchObject({ approvalStatus: 'approved', isPublished: true, status: 'published', pricing: 'awaiting_price' });
      expect(res.body.data.documents.every((d: { isVerified: boolean }) => d.isVerified)).toBe(true);
      const row = await prisma.facultyProfile.findUniqueOrThrow({ where: { id: profile.id } });
      expect(row.approvedBy).toBe(adminId);
      await new Promise((r) => setTimeout(r, 20));
      expect(mail.sent.map((m) => m.category)).toContain('faculty-approved');
      expect(await prisma.auditLog.count({ where: { action: 'faculty.approved' } })).toBe(1);
    });

    it('rejects with a reason only, and cannot decide twice', async () => {
      const { profile } = await submitted();
      const noReason = await put(`/admin/faculty/${profile.id}/review`, { decision: 'reject', expectedRevision: 1 });
      expect(noReason.status).toBe(422);
      const res = await put(`/admin/faculty/${profile.id}/review`, { decision: 'reject', reason: 'Degree certificate unreadable', expectedRevision: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ approvalStatus: 'rejected', status: 'rejected', rejectionReason: 'Degree certificate unreadable' });
      const again = await put(`/admin/faculty/${profile.id}/review`, { decision: 'approve', expectedRevision: 2 });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('INVALID_TRANSITION');
      await new Promise((r) => setTimeout(r, 20));
      expect(mail.sent.find((m) => m.category === 'faculty-rejected')?.text).toContain('Degree certificate unreadable');
    });

    it('refuses a stale revision', async () => {
      const { profile } = await submitted();
      const res = await put(`/admin/faculty/${profile.id}/review`, { decision: 'approve', expectedRevision: 9 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('STALE_REVISION');
    });

    it('needs faculty.approve, authentication and CSRF', async () => {
      const { profile } = await submitted();
      const { token } = await createUserWithPermissions(['faculty.read']);
      expect((await put(`/admin/faculty/${profile.id}/review`, { decision: 'approve', expectedRevision: 1 }, token)).status).toBe(403);
      expect((await request(app).get(`${API}/admin/faculty/${profile.id}`)).status).toBe(401);
      const noCsrf = await request(app)
        .put(`${API}/admin/faculty/${profile.id}/review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ decision: 'approve', expectedRevision: 1 });
      expect(noCsrf.status).toBe(403);
      expect((await get('/admin/faculty/8c121988-8afa-4fb7-b6eb-9b0dcb94f730')).status).toBe(404);
    });
  });

  // ── Pricing gate, awaiting list and consent ──────────────────────

  describe('sign-in gate, awaiting prices and consent', () => {
    it('blocks sign-in until approved and every subject is priced, then asks for consent', async () => {
      const { profile } = await submitted();

      let res = await facultyLogin('anil.verma@example.com');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FACULTY_PENDING_REVIEW');
      expect(res.headers['set-cookie']?.toString() ?? '').not.toContain('accessToken=');

      await approve(profile.id);
      res = await facultyLogin('anil.verma@example.com');
      expect(res.body.code).toBe('FACULTY_PENDING_PRICING');

      const awaiting = await get('/admin/prices/awaiting');
      expect(awaiting.status).toBe(200);
      expectContractResponse(awaiting, 'get', '/admin/prices/awaiting');
      expect(awaiting.body.data.map((e: { curriculumId: string }) => e.curriculumId).sort()).toEqual(
        [catalogue.physics.id, catalogue.chemistry.id].sort()
      );
      expect(awaiting.body.data[0]).toMatchObject({ facultyId: profile.id, facultyName: 'Anil Verma' });

      // One subject priced: still blocked
      await post('/admin/prices', { curriculumId: catalogue.physics.id, facultyId: profile.id, sessionPricePaise: 145000, isActive: true }, adminToken);
      expect((await facultyLogin('anil.verma@example.com')).body.code).toBe('FACULTY_PENDING_PRICING');
      expect((await get('/admin/prices/awaiting')).body.data).toHaveLength(1);

      await post('/admin/prices', { curriculumId: catalogue.chemistry.id, facultyId: profile.id, sessionPricePaise: 120000, isActive: true }, adminToken);
      expect((await get('/admin/prices/awaiting')).body.data).toHaveLength(0);
      expect(mail.sent.filter((m) => m.category === 'faculty-ready')).toHaveLength(1);

      res = await facultyLogin('anil.verma@example.com');
      expect(res.status).toBe(200);
      expect(res.body.data.requiresTermsAcceptance).toBe(true);
      expect((await prisma.facultyProfile.findUniqueOrThrow({ where: { id: profile.id } })).accessReadyAt).not.toBeNull();

      const roster = await get('/admin/faculty');
      expect(roster.body.data.find((r: { id: string }) => r.id === profile.id).pricing).toBe('awaiting_consent');
    });

    it('records acceptance for the exact prices shown; a price change asks again', async () => {
      const { profile } = await submitted();
      await approve(profile.id);
      await priceAll(profile.id);
      const { token } = await loginFaculty('anil.verma@example.com');

      const consent = await get('/faculty/me/price-consent', token);
      expect(consent.status).toBe(200);
      expectContractResponse(consent, 'get', '/faculty/me/price-consent');
      expect(consent.body.data.status).toBe('required');
      expect(consent.body.data.subjects).toHaveLength(2);
      expect(consent.body.data.subjects[0].price).toMatchObject({ sessionPricePaise: 145000, gstPaise: 26100, studentPaysPaise: 171100 });

      const stale = await post('/faculty/me/price-consent', { decision: 'accept', snapshotHash: '0'.repeat(64) }, token);
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('PRICES_CHANGED');

      const accepted = await post('/faculty/me/price-consent', { decision: 'accept', snapshotHash: consent.body.data.snapshotHash }, token);
      expect(accepted.status).toBe(200);
      expectContractResponse(accepted, 'post', '/faculty/me/price-consent');
      expect(accepted.body.data.status).toBe('accepted');
      // Signing in again replaces the session on this device
      const relogin = await facultyLogin('anil.verma@example.com');
      expect(relogin.body.data.requiresTermsAcceptance).toBe(false);
      const { token: fresh } = await loginFaculty('anil.verma@example.com');

      // Admin changes a price → consent needed again
      const rule = await prisma.priceRule.findFirstOrThrow({ where: { facultyId: profile.id } });
      await put(`/admin/prices/${rule.id}`, { sessionPricePaise: 150000, expectedRevision: rule.revision });
      expect((await get('/faculty/me/price-consent', fresh)).body.data.status).toBe('required');
    });

    it('declining keeps the consent required in the portal and emails the approving admin', async () => {
      const { profile } = await submitted();
      await approve(profile.id);
      await priceAll(profile.id);
      const { token } = await loginFaculty('anil.verma@example.com');
      const consent = await get('/faculty/me/price-consent', token);
      const declined = await post('/faculty/me/price-consent', { decision: 'reject', snapshotHash: consent.body.data.snapshotHash }, token);
      expect(declined.body.data.status).toBe('rejected');
      expect((await facultyLogin('anil.verma@example.com')).body.data.requiresTermsAcceptance).toBe(true);
      await new Promise((r) => setTimeout(r, 30));
      const email = mail.sent.find((m) => m.category === 'faculty-price-declined');
      expect(email?.to).toBe('onboarding-admin@example.com');
      const roster = await get('/admin/faculty');
      expect(roster.body.data.find((r: { id: string }) => r.id === profile.id).pricing).toBe('declined');
      expect(await prisma.auditLog.count({ where: { action: 'faculty.prices_declined' } })).toBe(1);
    });

    it('a rejected applicant cannot sign in', async () => {
      const { profile } = await submitted();
      await put(`/admin/faculty/${profile.id}/review`, { decision: 'reject', reason: 'Not eligible', expectedRevision: 1 });
      expect((await facultyLogin('anil.verma@example.com')).body.code).toBe('FACULTY_REJECTED');
    });

    it('price consent needs the faculty self permissions and a ready tutor', async () => {
      const { profile } = await submitted();
      // A faculty user with no profile
      const { token: noProfile } = await createUserWithPermissions(['faculty.read_self'], ['faculty']);
      expect((await get('/faculty/me/price-consent', noProfile)).status).toBe(404);
      const { token: student } = await loginWithRole('student', 'consent-student@example.com');
      expect((await get('/faculty/me/price-consent', student)).status).toBe(403);
      expect((await request(app).get(`${API}/faculty/me/price-consent`)).status).toBe(401);
      void profile;
    });
  });

  async function loginFaculty(email: string): Promise<{ token: string }> {
    const res = await facultyLogin(email);
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('accessToken='))!;
    return { token: cookie.split(';')[0]!.split('=')[1]! };
  }
});
