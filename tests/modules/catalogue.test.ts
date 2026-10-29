import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { createUserWithPermissions } from '../helpers/auth.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedCatalogue } from '../../prisma/seeds/catalogue';

// LMS-54: catalogue master lists, tree and admin API
describe('Catalogue API', () => {
  let csrf: { csrfToken: string; csrfCookie: string };
  let admin: { userId: string; token: string };
  let reader: { userId: string; token: string };
  let outsider: { userId: string; token: string };
  let ids: {
    school: string;
    university: string;
    k12: string;
    cbse: string;
    icse: string;
    physics: string;
    chemistry: string;
    class11: string;
    class12: string;
    year1: string;
  };

  const auth = (user: { token: string }) => ({ Authorization: `Bearer ${user.token}` });
  const write = (method: 'post' | 'put', url: string, user = admin) =>
    request(app)[method](url).set(auth(user)).set('Cookie', csrf.csrfCookie).set('x-csrf-token', csrf.csrfToken);

  const createPath = (body: Record<string, unknown>) => write('post', '/api/v1/admin/catalogue/paths').send(body);
  const schoolPath = (extra: Record<string, unknown> = {}) =>
    createPath({
      categoryId: ids.school,
      subsectionNodeId: ids.k12,
      boardId: ids.cbse,
      subjectId: ids.physics,
      levelId: ids.class11,
      ...extra,
    });

  beforeEach(async () => {
    await seedCatalogue(prisma as unknown as PrismaClient);
    csrf = await getCsrfData();
    admin = await createUserWithPermissions(['catalogue.read', 'catalogue.manage']);
    reader = await createUserWithPermissions(['catalogue.read']);
    outsider = await createUserWithPermissions([], ['student']);

    const category = async (code: string) => (await prisma.category.findUniqueOrThrow({ where: { code } })).id;
    const school = await category('school');
    const schoolRoot = await prisma.catalogueNode.findUniqueOrThrow({ where: { categoryId: school } });
    const k12 = await prisma.catalogueNode.findFirstOrThrow({ where: { parentId: schoolRoot.id, slug: 'k-12' } });
    ids = {
      school,
      university: await category('university'),
      k12: k12.id,
      cbse: (await prisma.board.findUniqueOrThrow({ where: { code: 'cbse' } })).id,
      icse: (await prisma.board.findUniqueOrThrow({ where: { code: 'icse' } })).id,
      physics: (await prisma.subject.findUniqueOrThrow({ where: { code: 'physics' } })).id,
      chemistry: (await prisma.subject.findUniqueOrThrow({ where: { code: 'chemistry' } })).id,
      class11: (await prisma.level.findUniqueOrThrow({ where: { code: 'class-11' } })).id,
      class12: (await prisma.level.findUniqueOrThrow({ where: { code: 'class-12' } })).id,
      year1: (await prisma.level.findUniqueOrThrow({ where: { code: 'year-1' } })).id,
    };
  });

  describe('master lists (public, list-only)', () => {
    it('lists the four categories in display order with a short public cache', async () => {
      const res = await request(app).get('/api/v1/catalogue/categories');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.body.data.map((c: { code: string }) => c.code)).toEqual([
        'school',
        'university',
        'jee-neet',
        'research-skill',
      ]);
    });

    it('lists a category’s levels in sortOrder, so Class 2 comes before Class 10', async () => {
      const res = await request(app).get(`/api/v1/catalogue/levels?categoryId=${ids.school}&limit=100`);
      expect(res.status).toBe(200);
      const names = res.body.data.map((l: { name: string }) => l.name);
      expect(names).toHaveLength(12);
      expect(names.indexOf('Class 2')).toBeLessThan(names.indexOf('Class 10'));
    });

    it('hides inactive rows publicly but shows them to admins', async () => {
      await prisma.subject.update({ where: { id: ids.chemistry }, data: { isActive: false } });
      const pub = await request(app).get('/api/v1/catalogue/subjects?limit=100');
      expect(pub.body.data.map((s: { code: string }) => s.code)).not.toContain('chemistry');

      const adm = await request(app).get('/api/v1/admin/catalogue/subjects?isActive=false').set(auth(reader));
      expect(adm.status).toBe(200);
      expect(adm.body.data.map((s: { code: string }) => s.code)).toEqual(['chemistry']);
    });

    it('rejects unknown query parameters', async () => {
      const res = await request(app).get('/api/v1/catalogue/boards?foo=1');
      expect(res.status).toBe(422);
    });
  });

  describe('access control', () => {
    it('returns 401 without a token and 403 without the permission', async () => {
      expect((await request(app).get(`/api/v1/admin/catalogue/tree?categoryId=${ids.school}`)).status).toBe(401);
      const res = await request(app).get(`/api/v1/admin/catalogue/tree?categoryId=${ids.school}`).set(auth(outsider));
      expect(res.status).toBe(403);
    });

    it('requires catalogue.manage for writes', async () => {
      const res = await write('post', '/api/v1/admin/catalogue/paths', reader).send({});
      expect(res.status).toBe(403);
    });

    it('rejects a write without a matching CSRF token', async () => {
      const res = await request(app)
        .post('/api/v1/admin/catalogue/paths')
        .set(auth(admin))
        .set('Cookie', csrf.csrfCookie)
        .set('x-csrf-token', 'wrong-token')
        .send({});
      expect(res.status).toBe(403);
    });
  });

  describe('add path (screen 28a)', () => {
    it('creates the missing nodes and a curriculum owned by the leaf', async () => {
      const res = await schoolPath();
      expect(res.status).toBe(201);
      expect(res.body.data.createdNodeIds).toHaveLength(3);
      const leaf = res.body.data.leaf;
      expect(leaf.type).toBe('LEVEL');
      expect(leaf.status).toBe('DRAFT');
      expect(leaf.path.map((p: { name: string }) => p.name)).toEqual(['School', 'K-12', 'CBSE', 'Physics']);

      const curriculum = await prisma.curriculum.findUniqueOrThrow({ where: { nodeId: leaf.id } });
      expect(curriculum).toMatchObject({
        categoryId: ids.school,
        boardId: ids.cbse,
        subjectId: ids.physics,
        levelId: ids.class11,
        isActive: false,
      });
      expect(leaf.curriculumId).toBe(curriculum.id);
    });

    it('reuses existing intermediate nodes', async () => {
      await schoolPath();
      const res = await schoolPath({ levelId: ids.class12 });
      expect(res.status).toBe(201);
      expect(res.body.data.createdNodeIds).toHaveLength(1);
      expect(await prisma.catalogueNode.count({ where: { type: 'SUBJECT' } })).toBe(1);
    });

    it('returns 409 for an existing path', async () => {
      await schoolPath();
      const res = await schoolPath();
      expect(res.status).toBe(409);
    });

    it('returns 409 when the same combination is added under another subsection', async () => {
      await schoolPath();
      const sub = await write('post', '/api/v1/admin/catalogue/nodes').send({
        parentId: (await prisma.catalogueNode.findUniqueOrThrow({ where: { id: ids.k12 } })).parentId,
        type: 'SUBSECTION',
        name: 'Competitive',
      });
      expect(sub.status).toBe(201);
      const res = await schoolPath({ subsectionNodeId: sub.body.data.id });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/only once/);
    });

    it('enforces the board rule per category', async () => {
      const missingBoard = await schoolPath({ boardId: undefined });
      expect(missingBoard.status).toBe(422);

      const boardOutsideSchool = await createPath({
        categoryId: ids.university,
        boardId: ids.cbse,
        subjectId: ids.physics,
        levelId: ids.year1,
      });
      expect(boardOutsideSchool.status).toBe(422);

      const university = await createPath({ categoryId: ids.university, subjectId: ids.physics, levelId: ids.year1 });
      expect(university.status).toBe(201);
      expect(university.body.data.leaf.path.map((p: { type: string }) => p.type)).toEqual(['CATEGORY', 'SUBJECT']);
    });

    it('rejects inactive masters and levels of another category', async () => {
      await prisma.subject.update({ where: { id: ids.physics }, data: { isActive: false } });
      expect((await schoolPath()).status).toBe(422);
      await prisma.subject.update({ where: { id: ids.physics }, data: { isActive: true } });

      expect((await schoolPath({ levelId: ids.year1 })).status).toBe(422);
    });
  });

  describe('publishing and public reads', () => {
    async function publishPath(leafId: string) {
      const detail = await request(app).get(`/api/v1/admin/catalogue/nodes/${leafId}`).set(auth(reader));
      for (const p of detail.body.data.path.filter((n: { type: string }) => n.type !== 'CATEGORY')) {
        await write('put', `/api/v1/admin/catalogue/nodes/${p.id}`).send({ status: 'PUBLISHED' });
      }
      await write('put', `/api/v1/admin/catalogue/nodes/${leafId}`).send({ status: 'PUBLISHED' });
    }

    it('shows a leaf publicly only when it and every ancestor are published', async () => {
      const leafId = (await schoolPath()).body.data.leaf.id;

      const draft = await request(app).get(`/api/v1/catalogue/tree?categoryId=${ids.school}`);
      expect(draft.body.data.counts.levels).toBe(0);
      expect((await request(app).get(`/api/v1/catalogue/nodes/${leafId}`)).status).toBe(404);

      await publishPath(leafId);
      const published = await request(app).get(`/api/v1/catalogue/tree?categoryId=${ids.school}`);
      expect(published.body.data.counts.levels).toBe(1);
      expect((await request(app).get(`/api/v1/catalogue/nodes/${leafId}`)).status).toBe(200);

      const curricula = await request(app).get(`/api/v1/catalogue/curricula?categoryId=${ids.school}&boardId=${ids.cbse}`);
      expect(curricula.body.data).toHaveLength(1);
      expect(curricula.body.data[0].name).toBe('CBSE · Physics · Class 11');
    });

    it('hides an archived node and its curriculum', async () => {
      const leafId = (await schoolPath()).body.data.leaf.id;
      await publishPath(leafId);
      const res = await write('put', `/api/v1/admin/catalogue/nodes/${leafId}/archive`);
      expect(res.status).toBe(200);

      expect((await request(app).get(`/api/v1/catalogue/tree?categoryId=${ids.school}`)).body.data.counts.levels).toBe(0);
      expect((await request(app).get('/api/v1/catalogue/curricula')).body.data).toHaveLength(0);
      const curriculum = await prisma.curriculum.findUniqueOrThrow({ where: { nodeId: leafId } });
      expect(curriculum.isActive).toBe(false);
    });

    it('returns the admin tree with drafts, counts and search', async () => {
      await schoolPath();
      await schoolPath({ subjectId: ids.chemistry });
      const all = await request(app).get(`/api/v1/admin/catalogue/tree?categoryId=${ids.school}`).set(auth(reader));
      expect(all.status).toBe(200);
      expect(all.body.data.counts).toEqual({ subsections: 1, boards: 1, subjects: 2, levels: 2 });

      const search = await request(app)
        .get(`/api/v1/admin/catalogue/tree?categoryId=${ids.school}&q=chem`)
        .set(auth(reader));
      expect(search.body.data.counts.subjects).toBe(1);
    });

    it('returns null counts for modules that do not exist yet', async () => {
      const leafId = (await schoolPath()).body.data.leaf.id;
      const res = await request(app).get(`/api/v1/admin/catalogue/nodes/${leafId}`).set(auth(reader));
      expect(res.body.data).toMatchObject({
        libraryResources: null,
        tutorsMapped: null,
        sessionsThisMonth: null,
        sessionPricePaise: null,
      });
    });
  });

  describe('single node writes', () => {
    it('rejects a wrong parent type and an archived parent', async () => {
      const leaf = (await schoolPath()).body.data.leaf;
      const boardNode = leaf.path.find((p: { type: string }) => p.type === 'BOARD');

      const levelUnderBoard = await write('post', '/api/v1/admin/catalogue/nodes').send({
        parentId: boardNode.id,
        type: 'LEVEL',
        levelId: ids.class12,
      });
      expect(levelUnderBoard.status).toBe(422);

      const subsectionUnderBoard = await write('post', '/api/v1/admin/catalogue/nodes').send({
        parentId: boardNode.id,
        type: 'SUBSECTION',
        name: 'Nope',
      });
      expect(subsectionUnderBoard.status).toBe(422);

      await write('put', `/api/v1/admin/catalogue/nodes/${leaf.id}/archive`);
      const subjectNode = leaf.path.find((p: { type: string }) => p.type === 'SUBJECT');
      await write('put', `/api/v1/admin/catalogue/nodes/${subjectNode.id}/archive`);
      const underArchived = await write('post', '/api/v1/admin/catalogue/nodes').send({
        parentId: subjectNode.id,
        type: 'LEVEL',
        levelId: ids.class12,
      });
      expect(underArchived.status).toBe(422);
    });

    it('returns 409 for a duplicate sibling slug', async () => {
      const root = await prisma.catalogueNode.findUniqueOrThrow({ where: { id: ids.k12 } });
      const res = await write('post', '/api/v1/admin/catalogue/nodes').send({
        parentId: root.parentId,
        type: 'SUBSECTION',
        name: 'K 12 again',
        slug: 'k-12',
      });
      expect(res.status).toBe(409);
    });

    it('does not allow creating or archiving category nodes', async () => {
      const root = await prisma.catalogueNode.findUniqueOrThrow({ where: { categoryId: ids.school } });
      expect((await write('put', `/api/v1/admin/catalogue/nodes/${root.id}/archive`)).status).toBe(422);
    });
  });

  describe('move', () => {
    it('re-parents a subject and keeps its curriculum in sync', async () => {
      const leaf = (await schoolPath()).body.data.leaf;
      const subjectNode = leaf.path.find((p: { type: string }) => p.type === 'SUBJECT');
      const icse = await write('post', '/api/v1/admin/catalogue/nodes').send({
        parentId: ids.k12,
        type: 'BOARD',
        boardId: ids.icse,
      });
      expect(icse.status).toBe(201);

      const res = await write('put', `/api/v1/admin/catalogue/nodes/${subjectNode.id}/move`).send({
        parentId: icse.body.data.id,
      });
      expect(res.status).toBe(200);
      const curriculum = await prisma.curriculum.findUniqueOrThrow({ where: { nodeId: leaf.id } });
      expect(curriculum.boardId).toBe(ids.icse);
    });

    it('blocks cycles and moves into another category', async () => {
      const leaf = (await schoolPath()).body.data.leaf;
      const boardNode = leaf.path.find((p: { type: string }) => p.type === 'BOARD');
      const subjectNode = leaf.path.find((p: { type: string }) => p.type === 'SUBJECT');

      const cycle = await write('put', `/api/v1/admin/catalogue/nodes/${boardNode.id}/move`).send({
        parentId: subjectNode.id,
      });
      expect(cycle.status).toBe(422);

      const universityRoot = await prisma.catalogueNode.findUniqueOrThrow({ where: { categoryId: ids.university } });
      const cross = await write('put', `/api/v1/admin/catalogue/nodes/${subjectNode.id}/move`).send({
        parentId: universityRoot.id,
      });
      expect(cross.status).toBe(422);
    });

    it('blocks moving offerings that a tutor already uses', async () => {
      const leaf = (await schoolPath()).body.data.leaf;
      const user = await createUserWithPermissions([], ['faculty']);
      const faculty = await prisma.facultyProfile.create({ data: { userId: user.userId } });
      await prisma.facultyAssignment.create({ data: { facultyId: faculty.id, curriculumId: leaf.curriculumId } });

      const icse = await write('post', '/api/v1/admin/catalogue/nodes').send({
        parentId: ids.k12,
        type: 'BOARD',
        boardId: ids.icse,
      });
      const subjectNode = leaf.path.find((p: { type: string }) => p.type === 'SUBJECT');
      const res = await write('put', `/api/v1/admin/catalogue/nodes/${subjectNode.id}/move`).send({
        parentId: icse.body.data.id,
      });
      expect(res.status).toBe(409);
    });
  });

  describe('archive and reorder', () => {
    it('blocks archiving while a child is not archived', async () => {
      const leaf = (await schoolPath()).body.data.leaf;
      const subjectNode = leaf.path.find((p: { type: string }) => p.type === 'SUBJECT');

      expect((await write('put', `/api/v1/admin/catalogue/nodes/${subjectNode.id}/archive`)).status).toBe(409);
      expect((await write('put', `/api/v1/admin/catalogue/nodes/${leaf.id}/archive`)).status).toBe(200);
      expect((await write('put', `/api/v1/admin/catalogue/nodes/${subjectNode.id}/archive`)).status).toBe(200);
    });

    it('reorders every child of a parent and rejects a partial list', async () => {
      await schoolPath();
      const second = await schoolPath({ levelId: ids.class12 });
      const subjectNode = second.body.data.leaf.path.find((p: { type: string }) => p.type === 'SUBJECT');
      const children = await prisma.catalogueNode.findMany({
        where: { parentId: subjectNode.id },
        orderBy: { sortOrder: 'asc' },
      });
      const reversed = children.map((c) => c.id).reverse();

      const res = await write('put', '/api/v1/admin/catalogue/nodes/reorder').send({
        parentId: subjectNode.id,
        orderedIds: reversed,
      });
      expect(res.status).toBe(200);
      const after = await prisma.catalogueNode.findMany({ where: { parentId: subjectNode.id }, orderBy: { sortOrder: 'asc' } });
      expect(after.map((c) => c.id)).toEqual(reversed);

      const partial = await write('put', '/api/v1/admin/catalogue/nodes/reorder').send({
        parentId: subjectNode.id,
        orderedIds: [reversed[0]],
      });
      expect(partial.status).toBe(422);
    });
  });

  describe('audit', () => {
    it('records every change with the acting admin and the values', async () => {
      const leaf = (await schoolPath()).body.data.leaf;
      await write('put', `/api/v1/admin/catalogue/nodes/${leaf.id}`).send({ name: 'Class XI' });

      const entries = await prisma.auditLog.findMany({
        where: { entity: 'catalogue_node', actorId: admin.userId, action: { in: ['create', 'update'] } },
      });
      expect(entries.filter((e) => e.action === 'create')).toHaveLength(3);
      const update = entries.find((e) => e.action === 'update' && e.resourceId === leaf.id);
      expect(update?.previousValue).toMatchObject({ name: 'Class 11' });
      expect(update?.newValue).toMatchObject({ name: 'Class XI' });
    });
  });
});
