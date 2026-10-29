import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { createUserWithPermissions } from '../helpers/auth.js';
import { createPublishedOffering } from '../helpers/catalogue.js';
import { createFacultyProfile } from '../helpers/faculty.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedCatalogue } from '../../prisma/seeds/catalogue';

// LMS-58: price rules, resolution, quotes and bulk edit
describe('Pricing API', () => {
  let csrf: { csrfToken: string; csrfCookie: string };
  let admin: { userId: string; token: string };
  let reader: { userId: string; token: string };
  let outsider: { userId: string; token: string };
  let cbsePhysics11: Awaited<ReturnType<typeof createPublishedOffering>>;
  let icsePhysics11: Awaited<ReturnType<typeof createPublishedOffering>>;
  let anil: { id: string };
  let meera: { id: string };

  const auth = (user: { token: string }) => ({ Authorization: `Bearer ${user.token}` });
  const send = (method: 'post' | 'put', url: string, user = admin) =>
    request(app)[method](url).set(auth(user)).set('Cookie', csrf.csrfCookie).set('x-csrf-token', csrf.csrfToken);
  const createRule = (body: Record<string, unknown>) => send('post', '/api/v1/admin/prices').send(body);
  const resolve = (params: Record<string, string>) =>
    request(app).get(`/api/v1/prices/resolve?${new URLSearchParams(params).toString()}`);

  beforeEach(async () => {
    await seedCatalogue(prisma as unknown as PrismaClient);
    csrf = await getCsrfData();
    admin = await createUserWithPermissions(['pricing.read', 'pricing.manage', 'catalogue.read', 'catalogue.manage']);
    reader = await createUserWithPermissions(['pricing.read']);
    outsider = await createUserWithPermissions([], ['student']);
    cbsePhysics11 = await createPublishedOffering({
      category: 'school',
      subsection: 'k-12',
      board: 'cbse',
      subject: 'physics',
      level: 'class-11',
    });
    icsePhysics11 = await createPublishedOffering({
      category: 'school',
      subsection: 'k-12',
      board: 'icse',
      subject: 'physics',
      level: 'class-11',
    });
    anil = await createFacultyProfile('Anil Kumar');
    meera = await createFacultyProfile('Meera Nair');
  });

  describe('access control', () => {
    it('returns 401 without a token and 403 without pricing permissions', async () => {
      expect((await request(app).get('/api/v1/admin/prices')).status).toBe(401);
      expect((await request(app).get('/api/v1/admin/prices').set(auth(outsider))).status).toBe(403);
      expect((await request(app).get('/api/v1/admin/prices').set(auth(reader))).status).toBe(200);
    });

    it('requires pricing.manage and a CSRF token for writes', async () => {
      const body = { curriculumId: cbsePhysics11.curriculum.id, facultyId: null, sessionPricePaise: 145000 };
      expect((await send('post', '/api/v1/admin/prices', reader).send(body)).status).toBe(403);
      const noCsrf = await request(app).post('/api/v1/admin/prices').set(auth(admin)).send(body);
      expect(noCsrf.status).toBe(403);
    });
  });

  describe('create', () => {
    it('computes GST and the student total on the server', async () => {
      const res = await createRule({ curriculumId: cbsePhysics11.curriculum.id, facultyId: null, sessionPricePaise: 145000 });
      expect(res.status).toBe(201);
      expect(res.body.data.amounts).toEqual({
        currency: 'INR',
        durationMinutes: 60,
        sessionPricePaise: 145000,
        gstRateBps: 1800,
        gstPaise: 26100,
        cgstPaise: 13050,
        sgstPaise: 13050,
        studentPaysPaise: 171100,
      });
      expect(res.body.data).toMatchObject({
        facultyId: null,
        categoryName: 'School',
        boardName: 'CBSE',
        subjectName: 'Physics',
        levelName: 'Class 11',
        revision: 1,
      });
    });

    it('never accepts client-supplied GST or totals', async () => {
      const res = await createRule({
        curriculumId: cbsePhysics11.curriculum.id,
        facultyId: null,
        sessionPricePaise: 145000,
        gstPaise: 1,
        studentPaysPaise: 145001,
      });
      expect(res.status).toBe(422);
    });

    it('rejects zero, unknown curricula and inactive tutors', async () => {
      const zero = await createRule({ curriculumId: cbsePhysics11.curriculum.id, facultyId: null, sessionPricePaise: 0 });
      expect(zero.status).toBe(422);
      const unknown = await createRule({ curriculumId: crypto.randomUUID(), facultyId: null, sessionPricePaise: 1000 });
      expect(unknown.status).toBe(422);
      const inactive = await createFacultyProfile('Inactive Tutor', { isActive: false });
      const res = await createRule({ curriculumId: cbsePhysics11.curriculum.id, facultyId: inactive.id, sessionPricePaise: 1000 });
      expect(res.status).toBe(422);
    });

    it('returns 409 for an overlapping active rule but allows separate windows and other tutors', async () => {
      const base = { curriculumId: cbsePhysics11.curriculum.id, sessionPricePaise: 100000 };
      expect((await createRule({ ...base, facultyId: null, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2026-07-01T00:00:00Z' })).status).toBe(201);
      expect((await createRule({ ...base, facultyId: null, effectiveFrom: '2026-06-01T00:00:00Z' })).status).toBe(409);
      expect((await createRule({ ...base, facultyId: null, effectiveFrom: '2026-07-01T00:00:00Z' })).status).toBe(201);
      expect((await createRule({ ...base, facultyId: anil.id, effectiveFrom: '2026-01-01T00:00:00Z' })).status).toBe(201);
      expect((await createRule({ ...base, facultyId: anil.id, effectiveFrom: '2026-03-01T00:00:00Z' })).status).toBe(409);
      // An inactive rule does not block
      expect((await createRule({ ...base, facultyId: meera.id, isActive: false })).status).toBe(201);
      expect((await createRule({ ...base, facultyId: meera.id })).status).toBe(201);
    });

    it('enforces the amount formula in the database', async () => {
      await expect(
        prisma.priceRule.create({
          data: { curriculumId: cbsePhysics11.curriculum.id, sessionPricePaise: 1000, gstPaise: 1, studentPaysPaise: 1001 },
        })
      ).rejects.toThrow(/price_rules_amounts_check/);
    });
  });

  describe('resolve', () => {
    beforeEach(async () => {
      await createRule({ curriculumId: cbsePhysics11.curriculum.id, facultyId: null, sessionPricePaise: 145000 });
      await createRule({ curriculumId: cbsePhysics11.curriculum.id, facultyId: anil.id, sessionPricePaise: 160000 });
    });

    it('1: uses the tutor rule and names it', async () => {
      const res = await resolve({ curriculumId: cbsePhysics11.curriculum.id, facultyId: anil.id });
      expect(res.status).toBe(200);
      const rule = await prisma.priceRule.findFirstOrThrow({ where: { facultyId: anil.id } });
      expect(res.body.data).toMatchObject({ available: true, matchedOn: 'FACULTY', matchedRuleId: rule.id });
      expect(res.body.data.amounts.sessionPricePaise).toBe(160000);
    });

    it('2: falls back to the default rule', async () => {
      const res = await resolve({ curriculumId: cbsePhysics11.curriculum.id, facultyId: meera.id });
      expect(res.body.data).toMatchObject({ available: true, matchedOn: 'DEFAULT', facultyId: null });
      expect(res.body.data.amounts.studentPaysPaise).toBe(171100);
    });

    it('3: returns PRICE_NOT_CONFIGURED, never zero', async () => {
      const res = await resolve({ curriculumId: icsePhysics11.curriculum.id });
      expect(res.body.data).toEqual({ available: false, reason: 'PRICE_NOT_CONFIGURED' });
      const past = await resolve({ curriculumId: cbsePhysics11.curriculum.id, at: '2000-01-01T00:00:00Z' });
      expect(past.body.data.reason).toBe('PRICE_NOT_CONFIGURED');
    });

    it('reports inactive catalogue entries and unknown ids', async () => {
      await prisma.curriculum.update({ where: { id: cbsePhysics11.curriculum.id }, data: { isActive: false } });
      const res = await resolve({ curriculumId: cbsePhysics11.curriculum.id });
      expect(res.body.data).toEqual({ available: false, reason: 'INACTIVE_CATALOGUE' });
      expect((await resolve({ curriculumId: crypto.randomUUID() })).status).toBe(404);
    });

    it('shows the default price in the catalogue detail panel', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/catalogue/nodes/${cbsePhysics11.leaf.id}`)
        .set(auth(admin));
      expect(res.body.data.sessionPricePaise).toBe(145000);
    });

    it('blocks moving a catalogue node whose offerings have prices', async () => {
      const icseBoard = await prisma.catalogueNode.findFirstOrThrow({ where: { type: 'BOARD', boardId: icsePhysics11.boardId } });
      const chemistry = await prisma.subject.findUniqueOrThrow({ where: { code: 'chemistry' } });
      const subject = await prisma.catalogueNode.create({
        data: {
          parentId: (await prisma.catalogueNode.findFirstOrThrow({ where: { type: 'BOARD', boardId: cbsePhysics11.boardId } })).id,
          rootId: cbsePhysics11.leaf.rootId,
          type: 'SUBJECT',
          name: 'Chemistry',
          slug: 'chemistry',
          subjectId: chemistry.id,
        },
      });
      expect(subject).toBeTruthy();
      const res = await send('put', `/api/v1/admin/catalogue/nodes/${cbsePhysics11.subjectNode.id}/move`).send({
        parentId: icseBoard.id,
      });
      expect(res.status).toBe(409);
    });
  });

  describe('quote (faculty registration)', () => {
    it('returns a range across boards when the board is omitted', async () => {
      await createRule({ curriculumId: cbsePhysics11.curriculum.id, facultyId: null, sessionPricePaise: 145000 });
      await createRule({ curriculumId: icsePhysics11.curriculum.id, facultyId: null, sessionPricePaise: 160000 });
      const res = await send('post', '/api/v1/prices/quote').send({
        items: [
          { categoryId: cbsePhysics11.categoryId, subjectId: cbsePhysics11.subjectId, levelId: cbsePhysics11.levelId },
          { curriculumId: cbsePhysics11.curriculum.id },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.data[0]).toMatchObject({ index: 0, available: true, curriculaMatched: 2, curriculaPriced: 2 });
      expect(res.body.data[0].min.sessionPricePaise).toBe(145000);
      expect(res.body.data[0].max.sessionPricePaise).toBe(160000);
      expect(res.body.data[1].min.sessionPricePaise).toBe(res.body.data[1].max.sessionPricePaise);
    });

    it('reports unpriced and unmatched items', async () => {
      const chemistry = await prisma.subject.findUniqueOrThrow({ where: { code: 'chemistry' } });
      const res = await send('post', '/api/v1/prices/quote').send({
        items: [
          { curriculumId: cbsePhysics11.curriculum.id },
          { categoryId: cbsePhysics11.categoryId, subjectId: chemistry.id, levelId: cbsePhysics11.levelId },
        ],
      });
      expect(res.body.data).toEqual([
        { index: 0, available: false, reason: 'PRICE_NOT_CONFIGURED' },
        { index: 1, available: false, reason: 'NO_MATCHING_CURRICULUM' },
      ]);
    });
  });

  describe('update and bulk edit', () => {
    let ruleA: { id: string; revision: number };
    let ruleB: { id: string; revision: number };

    beforeEach(async () => {
      ruleA = (await createRule({ curriculumId: cbsePhysics11.curriculum.id, facultyId: null, sessionPricePaise: 145000 })).body.data;
      ruleB = (await createRule({ curriculumId: icsePhysics11.curriculum.id, facultyId: null, sessionPricePaise: 150000 })).body.data;
    });

    it('updates with the expected revision and recalculates GST', async () => {
      const res = await send('put', `/api/v1/admin/prices/${ruleA.id}`).send({ sessionPricePaise: 160000, expectedRevision: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.revision).toBe(2);
      expect(res.body.data.amounts).toMatchObject({ gstPaise: 28800, studentPaysPaise: 188800 });

      const stale = await send('put', `/api/v1/admin/prices/${ruleA.id}`).send({ sessionPricePaise: 1, expectedRevision: 1 });
      expect(stale.status).toBe(409);
    });

    it('deactivates a rule, which then stops resolving', async () => {
      const res = await send('put', `/api/v1/admin/prices/${ruleA.id}`).send({ isActive: false, expectedRevision: 1 });
      expect(res.status).toBe(200);
      const resolved = await resolve({ curriculumId: cbsePhysics11.curriculum.id });
      expect(resolved.body.data.reason).toBe('PRICE_NOT_CONFIGURED');
    });

    it('saves every bulk change together', async () => {
      const res = await send('put', '/api/v1/admin/prices/bulk').send({
        changes: [
          { id: ruleA.id, sessionPricePaise: 155000, expectedRevision: 1 },
          { id: ruleB.id, sessionPricePaise: 165000, expectedRevision: 1 },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.data.map((r: { amounts: { sessionPricePaise: number } }) => r.amounts.sessionPricePaise)).toEqual([155000, 165000]);
    });

    it('saves nothing when any bulk change is rejected and lists the faulty rows', async () => {
      const res = await send('put', '/api/v1/admin/prices/bulk').send({
        changes: [
          { id: ruleA.id, sessionPricePaise: 155000, expectedRevision: 1 },
          { id: ruleB.id, sessionPricePaise: 165000, expectedRevision: 7 },
          { id: crypto.randomUUID(), sessionPricePaise: 1000, expectedRevision: 1 },
        ],
      });
      expect(res.status).toBe(409);
      expect(Object.keys(res.body.errors)).toEqual(['changes[1]', 'changes[2]']);
      const a = await prisma.priceRule.findUniqueOrThrow({ where: { id: ruleA.id } });
      expect(a.sessionPricePaise).toBe(145000);
      expect(a.revision).toBe(1);
    });
  });

  describe('list and audit', () => {
    it('filters by tutor and searches by name', async () => {
      await createRule({ curriculumId: cbsePhysics11.curriculum.id, facultyId: null, sessionPricePaise: 145000 });
      await createRule({ curriculumId: cbsePhysics11.curriculum.id, facultyId: anil.id, sessionPricePaise: 160000 });

      const byTutor = await request(app).get(`/api/v1/admin/prices?facultyId=${anil.id}`).set(auth(reader));
      expect(byTutor.body.data).toHaveLength(1);
      expect(byTutor.body.data[0].facultyName).toBe('Anil Kumar');

      const defaults = await request(app).get('/api/v1/admin/prices?defaultOnly=true').set(auth(reader));
      expect(defaults.body.data).toHaveLength(1);

      const search = await request(app).get('/api/v1/admin/prices?q=anil').set(auth(reader));
      expect(search.body.data).toHaveLength(1);
      expect(search.body.meta.total).toBe(1);
    });

    it('audits every price change with old and new values', async () => {
      const rule = (await createRule({ curriculumId: cbsePhysics11.curriculum.id, facultyId: null, sessionPricePaise: 145000 })).body.data;
      await send('put', `/api/v1/admin/prices/${rule.id}`).send({ sessionPricePaise: 150000, expectedRevision: 1 });

      const entries = await prisma.auditLog.findMany({ where: { entity: 'price_rule', resourceId: rule.id }, orderBy: { createdAt: 'asc' } });
      expect(entries.map((e) => e.action)).toEqual(['create', 'update']);
      expect(entries[1].previousValue).toMatchObject({ sessionPricePaise: 145000 });
      expect(entries[1].newValue).toMatchObject({ sessionPricePaise: 150000, gstPaise: 27000 });
      expect(entries[1].actorId).toBe(admin.userId);
    });
  });
});
