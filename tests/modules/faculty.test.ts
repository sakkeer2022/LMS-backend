import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { loginWithRole } from '../helpers/users.js';
import { createUserWithPermissions } from '../helpers/auth.js';
import { expectContractResponse } from '../helpers/contract.js';
import { createLookups, createOffering, createTreeNode } from '../helpers/category-tree.js';
import { createInvitation, createRosterProfile } from '../helpers/faculty.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';
import {
  EmailDeliveryError,
  InMemoryEmailProvider,
  setEmailProvider,
} from '../../src/infrastructure/email/index.js';
import { hashInviteToken } from '../../src/modules/faculty/faculty.tokens.js';

const BASE = '/api/v1/admin/faculty';
const INVITES = `${BASE}/invitations`;

describe('Faculty admin API (LMS-78, LMS-79)', () => {
  let adminToken: string;
  let adminId: string;
  let csrf: { csrfToken: string; csrfCookie: string };
  let mail: InMemoryEmailProvider;

  function invite(body: unknown, token = adminToken): request.Test {
    return request(app)
      .post(INVITES)
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', csrf.csrfCookie)
      .set('x-csrf-token', csrf.csrfToken)
      .send(body as object);
  }

  function list(query = '', token = adminToken): request.Test {
    return request(app).get(`${BASE}${query}`).set('Authorization', `Bearer ${token}`);
  }

  beforeEach(async () => {
    await seedRbac(prisma);
    ({ token: adminToken, userId: adminId } = await loginWithRole('admin', 'faculty-admin@example.com'));
    csrf = await getCsrfData();
    mail = new InMemoryEmailProvider();
    setEmailProvider(mail);
  });

  // ── POST /admin/faculty/invitations ─────────────────────────────

  describe('POST /admin/faculty/invitations', () => {
    it('creates a pending invitation, stores only the token hash and emails the link', async () => {
      const before = Date.now();
      const res = await invite({ emails: ['  Ananya.Iyer@Gmail.com '] });

      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.message).toBe('1 invitation sent');
      expect(res.body.data.inviteUrl).toBeNull();
      expect(res.body.data.invitations).toHaveLength(1);
      const view = res.body.data.invitations[0];
      expect(view).toMatchObject({
        email: 'ananya.iyer@gmail.com',
        status: 'pending',
        deliveryMethod: 'email',
        delivered: true,
      });
      expectContractResponse(res, 'post', '/admin/faculty/invitations');

      // 72 h lifetime (default FACULTY_INVITE_TTL_HOURS)
      const expiresAt = new Date(view.expiresAt).getTime();
      expect(expiresAt - before).toBeGreaterThanOrEqual(72 * 3600 * 1000 - 5000);
      expect(expiresAt - before).toBeLessThanOrEqual(72 * 3600 * 1000 + 5000);

      expect(mail.sent).toHaveLength(1);
      const sent = mail.sent[0]!;
      expect(sent.to).toBe('ananya.iyer@gmail.com');
      const link = /http:\/\/localhost:3003\/onboarding\?token=([A-Za-z0-9_-]{43})/.exec(sent.text);
      expect(link).not.toBeNull();
      const token = link![1]!;
      expect(sent.html).toContain(`/onboarding?token=${token}`);

      const row = await prisma.facultyInvitation.findUniqueOrThrow({ where: { id: view.id } });
      expect(row).toMatchObject({
        email: 'ananya.iyer@gmail.com',
        status: 'PENDING',
        deliveryMethod: 'EMAIL',
        invitedById: adminId,
        tokenHash: hashInviteToken(token),
      });
      expect(row.sentAt).not.toBeNull();
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it('invites several tutors at once and removes duplicates', async () => {
      const res = await invite({ emails: ['a@example.com', 'b@example.com', 'A@example.com'] });
      expect(res.status).toBe(201);
      expect(res.body.message).toBe('2 invitations sent');
      expect(res.body.data.invitations.map((i: { email: string }) => i.email)).toEqual(
        expect.arrayContaining(['a@example.com', 'b@example.com'])
      );
      expect(mail.sent.map((m) => m.to).sort()).toEqual(['a@example.com', 'b@example.com']);
      expect(await prisma.facultyInvitation.count()).toBe(2);
    });

    it('audits each invitation without the token', async () => {
      const res = await invite({ emails: ['audit@example.com'] });
      expect(res.status).toBe(201);
      const logs = await prisma.auditLog.findMany({ where: { action: 'faculty.invitation_created' } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorId: adminId, entity: 'faculty_invitation', resourceId: res.body.data.invitations[0].id });
      expect(logs[0]!.newValue).toMatchObject({ email: 'audit@example.com', deliveryMethod: 'EMAIL' });
      const token = /token=([A-Za-z0-9_-]+)/.exec(mail.sent[0]!.text)![1]!;
      expect(JSON.stringify(logs, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(token);
    });

    it('Copy link: creates the invitation without emailing and returns the link once', async () => {
      const res = await invite({ emails: ['link@example.com'], delivery: 'link' });
      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Invitation created');
      expect(res.body.data.invitations[0]).toMatchObject({ deliveryMethod: 'link', delivered: null, sentAt: null });
      expect(mail.sent).toHaveLength(0);
      const url = new URL(res.body.data.inviteUrl);
      expect(url.origin + url.pathname).toBe('http://localhost:3003/onboarding');
      const row = await prisma.facultyInvitation.findFirstOrThrow({ where: { email: 'link@example.com' } });
      expect(row.tokenHash).toBe(hashInviteToken(url.searchParams.get('token')!));
      expect(row.deliveryMethod).toBe('LINK');
      expectContractResponse(res, 'post', '/admin/faculty/invitations');
    });

    it('refuses an address that already has an account (any role), creating nothing', async () => {
      await prisma.user.create({
        data: { email: 'taken@example.com', passwordHash: 'x', fullName: 'Existing' },
      });
      const res = await invite({ emails: ['fresh@example.com', 'Taken@Example.com'] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('FACULTY_INVITE_CONFLICT');
      expect(res.body.message).toBe('taken@example.com already has an Amentorz account');
      expect(res.body.errors).toEqual({ emails: ['taken@example.com already has an Amentorz account'] });
      expect(await prisma.facultyInvitation.count()).toBe(0);
      expect(mail.sent).toHaveLength(0);
      expectContractResponse(res, 'post', '/admin/faculty/invitations');
    });

    it('refuses an address with a pending invitation and lists every conflict', async () => {
      await createInvitation({ email: 'pending@example.com' });
      await prisma.user.create({ data: { email: 'user@example.com', passwordHash: 'x', fullName: 'U' } });
      const res = await invite({ emails: ['pending@example.com', 'ok@example.com', 'user@example.com'] });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('2 of these email addresses cannot be invited');
      expect(res.body.errors.emails).toEqual([
        'pending@example.com already has a pending invitation',
        'user@example.com already has an Amentorz account',
      ]);
      expect(await prisma.facultyInvitation.count()).toBe(1);
    });

    it('re-invites an address whose invitation expired, marking the old one EXPIRED', async () => {
      const old = await createInvitation({ email: 'late@example.com', expired: true });
      const res = await invite({ emails: ['late@example.com'] });
      expect(res.status).toBe(201);
      expect((await prisma.facultyInvitation.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('EXPIRED');
      expect(await prisma.facultyInvitation.count({ where: { email: 'late@example.com', status: 'PENDING' } })).toBe(1);
    });

    it('enforces one pending invitation per email in the database', async () => {
      await createInvitation({ email: 'dup@example.com' });
      await expect(createInvitation({ email: 'dup@example.com' })).rejects.toThrow();
    });

    it('returns 502 and revokes the invitation when the email cannot be sent; it can then be retried', async () => {
      mail.failNext(new EmailDeliveryError('SendGrid rejected the message (HTTP 401)', 'sendgrid', 401));
      const res = await invite({ emails: ['bounce@example.com'] });
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('EMAIL_DELIVERY_FAILED');
      expect(res.body.errors.emails).toEqual(['bounce@example.com: the invitation email could not be sent']);
      const row = await prisma.facultyInvitation.findFirstOrThrow({ where: { email: 'bounce@example.com' } });
      expect(row).toMatchObject({ status: 'REVOKED', revokedReason: 'DELIVERY_FAILED' });
      expect(row.deliveryError).toBe('SendGrid rejected the message (HTTP 401)');
      expect(await prisma.auditLog.count({ where: { action: 'faculty.invitation_delivery_failed' } })).toBe(1);
      expectContractResponse(res, 'post', '/admin/faculty/invitations');

      const retry = await invite({ emails: ['bounce@example.com'] });
      expect(retry.status).toBe(201);
    });

    it('reports a partial delivery failure per invitation', async () => {
      mail.failNext(new EmailDeliveryError('down', 'memory', 503, true));
      const res = await invite({ emails: ['first@example.com', 'second@example.com'] });
      expect(res.status).toBe(201);
      expect(res.body.message).toBe('1 of 2 invitations sent');
      const delivered = res.body.data.invitations.map((i: { delivered: boolean; status: string }) => [i.delivered, i.status]);
      expect(delivered).toEqual(expect.arrayContaining([[false, 'revoked'], [true, 'pending']]));
    });

    it.each([
      [{}, 'emails'],
      [{ emails: [] }, 'emails'],
      [{ emails: ['not-an-email'] }, 'emails.0'],
      [{ emails: ['a@b.com'], delivery: 'link', extra: true }, ''],
      [{ emails: ['a@b.com', 'c@d.com'], delivery: 'link' }, 'emails'],
      [{ emails: Array.from({ length: 21 }, (_, i) => `t${i}@x.com`) }, 'emails'],
    ])('rejects %j with 422', async (body, field) => {
      const res = await invite(body);
      expect(res.status).toBe(422);
      if (field) expect(Object.keys(res.body.errors)).toContain(field);
      expect(await prisma.facultyInvitation.count()).toBe(0);
    });

    it('requires authentication', async () => {
      const res = await request(app)
        .post(INVITES)
        .set('Cookie', csrf.csrfCookie)
        .set('x-csrf-token', csrf.csrfToken)
        .send({ emails: ['a@example.com'] });
      expect(res.status).toBe(401);
    });

    it('requires faculty.create', async () => {
      const { token: studentToken } = await loginWithRole('student', 'faculty-student@example.com');
      expect((await invite({ emails: ['a@example.com'] }, studentToken)).status).toBe(403);
      const { token: readOnly } = await createUserWithPermissions(['faculty.read']);
      expect((await invite({ emails: ['a@example.com'] }, readOnly)).status).toBe(403);
      expect(await prisma.facultyInvitation.count()).toBe(0);
    });

    it('rejects a missing CSRF token', async () => {
      const res = await request(app)
        .post(INVITES)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ emails: ['a@example.com'] });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('CSRF token missing');
    });

    it('rejects a mismatched CSRF token', async () => {
      const res = await request(app)
        .post(INVITES)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Cookie', csrf.csrfCookie)
        .set('x-csrf-token', 'not-the-cookie-token')
        .send({ emails: ['a@example.com'] });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('CSRF token mismatch');
      expect(await prisma.facultyInvitation.count()).toBe(0);
    });

    it('rate-limits each admin (FACULTY_INVITE_RATE_LIMIT_MAX=5 in tests)', async () => {
      for (let i = 0; i < 5; i += 1) {
        expect((await invite({ emails: [`rl${i}@example.com`], delivery: 'link' })).status).toBe(201);
      }
      const limited = await invite({ emails: ['rl5@example.com'], delivery: 'link' });
      expect(limited.status).toBe(429);
      expect(limited.headers['retry-after']).toBeDefined();
      expect(limited.body.code).toBe('TOO_MANY_REQUESTS');
      expect(await prisma.facultyInvitation.count()).toBe(5);

      // Another admin has their own budget
      const { token: other } = await loginWithRole('admin', 'other-admin@example.com');
      expect((await invite({ emails: ['rl6@example.com'], delivery: 'link' }, other)).status).toBe(201);
    });
  });

  // ── GET /admin/faculty and /status-counts ───────────────────────

  describe('GET /admin/faculty', () => {
    async function seedRoster() {
      const invited = await createInvitation({ email: 'invited@example.com' });
      const expired = await createInvitation({ email: 'expired@example.com', expired: true });
      const pending = await createRosterProfile({ fullName: 'Anjali Deshpande', approvalStatus: 'PENDING' });
      const changes = await createRosterProfile({ fullName: 'Rakesh Menon', approvalStatus: 'CHANGES_REQUESTED' });
      const verified = await createRosterProfile({ fullName: 'Sneha Rao', approvalStatus: 'APPROVED' });
      const published = await createRosterProfile({ fullName: 'Kavita Rao', approvalStatus: 'APPROVED', isPublished: true });
      const rejected = await createRosterProfile({ fullName: 'Priya Menon', approvalStatus: 'REJECTED' });
      const suspendedProfile = await createRosterProfile({ fullName: 'Dev Sharma', approvalStatus: 'APPROVED', isPublished: true, isActive: false });
      const suspendedUser = await createRosterProfile({ fullName: 'Anil Verma', approvalStatus: 'APPROVED', userStatus: 'SUSPENDED' });
      // Accepted and revoked invitations are not listed
      await createInvitation({ email: 'accepted@example.com', status: 'ACCEPTED' });
      await createInvitation({ email: 'revoked@example.com', status: 'REVOKED' });
      return { invited, expired, pending, changes, verified, published, rejected, suspendedProfile, suspendedUser };
    }

    it('lists profiles and pending invitations with derived statuses', async () => {
      const r = await seedRoster();
      const res = await list('?limit=100');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expectContractResponse(res, 'get', '/admin/faculty?limit=100');
      const byId = new Map(res.body.data.map((row: { id: string; status: string }) => [row.id, row.status]));
      expect(Object.fromEntries(byId)).toEqual({
        [r.invited.id]: 'invited',
        [r.expired.id]: 'expired',
        [r.pending.id]: 'pending',
        [r.changes.id]: 'pending',
        [r.verified.id]: 'verified',
        [r.published.id]: 'published',
        [r.rejected.id]: 'rejected',
        [r.suspendedProfile.id]: 'suspended',
        [r.suspendedUser.id]: 'suspended',
      });
      expect(res.body.meta).toEqual({ page: 1, limit: 100, total: 9, totalPages: 1 });

      const invitedRow = res.body.data.find((row: { id: string }) => row.id === r.invited.id);
      expect(invitedRow).toMatchObject({ kind: 'invitation', fullName: null, documents: null, subjects: [], qualification: null });
      expect(invitedRow.invitation).toMatchObject({ deliveryMethod: 'email' });
    });

    it.each([
      ['pending', ['invited', 'pending', 'pending']],
      ['verified', ['verified']],
      ['published', ['published']],
      ['suspended', ['suspended', 'suspended']],
    ])('filters the %s tab', async (tab, statuses) => {
      await seedRoster();
      const res = await list(`?status=${tab}`);
      expect(res.status).toBe(200);
      expect(res.body.data.map((row: { status: string }) => row.status).sort()).toEqual([...statuses].sort());
      expect(res.body.meta.total).toBe(statuses.length);
    });

    it('returns tab counts', async () => {
      await seedRoster();
      const res = await request(app).get(`${BASE}/status-counts`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ all: 9, pending: 3, verified: 1, published: 1, suspended: 2 });
      expectContractResponse(res, 'get', '/admin/faculty/status-counts');
    });

    it('fills subjects, qualification and document counts for profiles', async () => {
      const root = await createTreeNode(null, { code: 'school' });
      const leaf = await createTreeNode(root, { code: 'k12', isBookable: true });
      const { subject, subject2 } = await createLookups();
      const physics = await createOffering({ categoryId: leaf.id, subjectId: subject.id });
      const chemistry = await createOffering({ categoryId: leaf.id, subjectId: subject2.id });
      const tutor = await createRosterProfile({
        fullName: 'Anjali Deshpande',
        curriculumIds: [physics.id, chemistry.id],
        qualifications: [
          { degree: 'M.Sc.', institution: 'Pune University', yearOfPassing: 2010 },
          { degree: 'Ph.D.', institution: 'IIT Bombay', yearOfPassing: 2015 },
        ],
        documents: 3,
      });
      const res = await list();
      const row = res.body.data.find((r: { id: string }) => r.id === tutor.id);
      expect(row).toMatchObject({
        kind: 'profile',
        fullName: 'Anjali Deshpande',
        qualification: 'Ph.D. · IIT Bombay',
        documents: { uploaded: 3, required: 3 },
        invitation: null,
      });
      expect([...row.subjects].sort()).toEqual([subject.name, subject2.name].sort());
    });

    it('filters by category subtree and hides invitations', async () => {
      const school = await createTreeNode(null, { code: 'school' });
      const k12 = await createTreeNode(school, { code: 'k12', isBookable: true });
      const jee = await createTreeNode(null, { code: 'jee', isBookable: true });
      const { subject } = await createLookups();
      const schoolOffering = await createOffering({ categoryId: k12.id, subjectId: subject.id });
      const jeeOffering = await createOffering({ categoryId: jee.id, subjectId: subject.id });
      const schoolTutor = await createRosterProfile({ fullName: 'School Tutor', curriculumIds: [schoolOffering.id] });
      await createRosterProfile({ fullName: 'JEE Tutor', curriculumIds: [jeeOffering.id] });
      await createRosterProfile({ fullName: 'Inactive Assignment', curriculumIds: [schoolOffering.id], assignmentActive: false });
      await createInvitation({ email: 'invited@example.com' });

      const res = await list(`?categoryId=${school.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([schoolTutor.id]);

      const counts = await request(app)
        .get(`${BASE}/status-counts?categoryId=${school.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(counts.body.data.all).toBe(1);
    });

    it('searches name and email, treating wildcards literally', async () => {
      await createRosterProfile({ fullName: 'Sneha Rao' });
      await createRosterProfile({ fullName: 'Kavita Rao' });
      await createRosterProfile({ fullName: 'Dev Sharma' });
      await createInvitation({ email: 'rao.invite@example.com' });
      await createInvitation({ email: 'abc_def@example.com' });
      await createInvitation({ email: 'abcxdef@example.com' });

      const res = await list('?search=RAO');
      expect(res.body.data).toHaveLength(3);
      // % and _ match themselves, not any characters
      expect((await list('?search=%25')).body.data).toHaveLength(0);
      const underscore = (await list('?search=c_d')).body.data;
      expect(underscore.map((r: { email: string }) => r.email)).toEqual(['abc_def@example.com']);
    });

    it('sorts and paginates', async () => {
      await createRosterProfile({ fullName: 'Charlie', createdAt: new Date('2026-08-03') });
      await createRosterProfile({ fullName: 'alpha', createdAt: new Date('2026-08-01') });
      await createRosterProfile({ fullName: 'Bravo', createdAt: new Date('2026-08-02') });

      const names = async (q: string) => (await list(q)).body.data.map((r: { fullName: string }) => r.fullName);
      expect(await names('?sort=recent')).toEqual(['Charlie', 'Bravo', 'alpha']);
      expect(await names('?sort=oldest')).toEqual(['alpha', 'Bravo', 'Charlie']);
      expect(await names('?sort=name')).toEqual(['alpha', 'Bravo', 'Charlie']);

      const page2 = await list('?sort=name&limit=2&page=2');
      expect(page2.body.data.map((r: { fullName: string }) => r.fullName)).toEqual(['Charlie']);
      expect(page2.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
    });

    it('excludes soft-deleted users', async () => {
      await createRosterProfile({ fullName: 'Gone', deleted: true });
      expect((await list()).body.meta.total).toBe(0);
    });

    it.each(['?status=archived', '?limit=500', '?unknown=1', '?categoryId=nope'])('rejects %s with 422', async (q) => {
      expect((await list(q)).status).toBe(422);
    });

    it('rejects an unknown category with 422', async () => {
      const res = await list('?categoryId=8c121988-8afa-4fb7-b6eb-9b0dcb94f730');
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('UNKNOWN_CATEGORY');
    });

    it('requires authentication', async () => {
      expect((await request(app).get(BASE)).status).toBe(401);
      expect((await request(app).get(`${BASE}/status-counts`)).status).toBe(401);
    });

    it('requires faculty.read', async () => {
      const { token } = await loginWithRole('student', 'roster-student@example.com');
      expect((await list('', token)).status).toBe(403);
      expect((await request(app).get(`${BASE}/status-counts`).set('Authorization', `Bearer ${token}`)).status).toBe(403);
      const { token: creator } = await createUserWithPermissions(['faculty.create']);
      expect((await list('', creator)).status).toBe(403);
    });
  });
});
