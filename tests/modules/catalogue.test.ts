import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { createUserWithPermissions } from '../helpers/auth.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedCatalogue } from '../../prisma/seeds/catalogue';
import { createPublishedOffering, tabByCode } from '../helpers/catalogue.js';

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

  beforeEach(async () => {
    await seedCatalogue(prisma as unknown as PrismaClient);
    csrf = await getCsrfData();
    admin = await createUserWithPermissions(['catalogue.read', 'catalogue.manage']);
    reader = await createUserWithPermissions(['catalogue.read']);
    outsider = await createUserWithPermissions([], ['student']);

    const category = async (code: string) => (await tabByCode(code)).id;
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

  describe('legacy tree is read-only (ADR-0005)', () => {
    it('refuses every write with CATALOGUE_TREE_MIGRATED and changes nothing', async () => {
      const before = await prisma.catalogueNode.count();
      const writes = [
        write('post', '/api/v1/admin/catalogue/paths').send({ categoryId: ids.school, subsectionNodeId: ids.k12, boardId: ids.cbse, subjectId: ids.physics, levelId: ids.class11 }),
        write('post', '/api/v1/admin/catalogue/nodes').send({ parentId: ids.k12, type: 'BOARD', boardId: ids.icse }),
        write('put', `/api/v1/admin/catalogue/nodes/${ids.k12}`).send({ name: 'Renamed' }),
        write('put', `/api/v1/admin/catalogue/nodes/${ids.k12}/move`).send({ parentId: ids.k12 }),
        write('put', `/api/v1/admin/catalogue/nodes/${ids.k12}/archive`),
        write('put', '/api/v1/admin/catalogue/nodes/reorder').send({ parentId: ids.k12, orderedIds: [ids.k12] }),
      ];
      for (const res of await Promise.all(writes)) {
        expect([res.status, res.body.code]).toEqual([409, 'CATALOGUE_TREE_MIGRATED']);
      }
      expect(await prisma.catalogueNode.count()).toBe(before);
    });
  });

  describe('legacy reads', () => {
    it('serves the published legacy tree and matches a tab id against the curricula of its leaves', async () => {
      const offering = await createPublishedOffering({ category: 'school', subsection: 'k-12', board: 'cbse', subject: 'physics', level: 'class-11' });
      const tree = await request(app).get(`/api/v1/catalogue/tree?categoryId=${ids.school}`);
      expect(tree.body.data.counts.levels).toBe(1);
      expect((await request(app).get(`/api/v1/catalogue/nodes/${offering.leaf.id}`)).status).toBe(200);

      // The curriculum now belongs to the K-12 leaf; the School tab id still finds it
      const curricula = await request(app).get(`/api/v1/catalogue/curricula?categoryId=${ids.school}&boardId=${ids.cbse}`);
      expect(curricula.body.data).toHaveLength(1);
      expect(curricula.body.data[0]).toMatchObject({ name: 'CBSE · Physics · Class 11', categoryId: offering.categoryId });
    });

    it('returns the admin tree with counts and null counts for modules that do not exist yet', async () => {
      const offering = await createPublishedOffering({ category: 'school', subsection: 'k-12', board: 'cbse', subject: 'physics', level: 'class-11' });
      await createPublishedOffering({ category: 'school', subsection: 'k-12', board: 'cbse', subject: 'chemistry', level: 'class-11' });
      const all = await request(app).get(`/api/v1/admin/catalogue/tree?categoryId=${ids.school}`).set(auth(reader));
      expect(all.body.data.counts).toEqual({ subsections: 1, boards: 1, subjects: 2, levels: 2 });
      const node = await request(app).get(`/api/v1/admin/catalogue/nodes/${offering.leaf.id}`).set(auth(reader));
      expect(node.body.data).toMatchObject({ libraryResources: null, tutorsMapped: null, sessionsThisMonth: null, sessionPricePaise: null });
    });
  });
});
