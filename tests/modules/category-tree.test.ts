import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { createUserWithPermissions } from '../helpers/auth.js';
import {
  allowLevels,
  createLookups,
  createOffering,
  createTreeNode,
  setFlag,
  type TreeNodeFixture,
} from '../helpers/category-tree.js';
import { prisma } from '@infrastructure/database/index.js';

// ADR-0005: category tree admin API, invariants, concurrency and learner read path
describe('Category tree API', () => {
  let csrf: { csrfToken: string; csrfCookie: string };
  let admin: { userId: string; token: string };
  let reader: { userId: string; token: string };
  let academic: TreeNodeFixture;
  let school: TreeNodeFixture;
  let k12: TreeNodeFixture;
  let lookups: Awaited<ReturnType<typeof createLookups>>;

  const base = '/api/v1/admin/category-tree';
  const auth = (user: { token: string }) => ({ Authorization: `Bearer ${user.token}` });
  const send = (method: 'post' | 'put' | 'patch' | 'delete', url: string, user = admin) =>
    request(app)
      [method](url)
      .set(auth(user))
      .set('Cookie', csrf.csrfCookie)
      .set('x-csrf-token', csrf.csrfToken);
  const node = (id: string) => prisma.category.findUniqueOrThrow({ where: { id } });
  const verify = async () =>
    (
      await prisma.$queryRaw<
        { check_name: string; failures: bigint }[]
      >`SELECT * FROM category_tree_verify()`
    ).filter((r) => Number(r.failures) > 0);

  beforeEach(async () => {
    csrf = await getCsrfData();
    admin = await createUserWithPermissions(['catalogue.read', 'catalogue.manage']);
    reader = await createUserWithPermissions(['catalogue.read']);
    academic = await createTreeNode(null, { code: 'academic', name: 'Academic' });
    school = await createTreeNode(academic, {
      code: 'school',
      name: 'School',
      requiresBoard: true,
    });
    k12 = await createTreeNode(school, { code: 'k-12', name: 'K-12', requiresBoard: true });
    lookups = await createLookups();
  });

  describe('access control', () => {
    it('returns 401 without a token and 403 without catalogue.read', async () => {
      expect((await request(app).get(base)).status).toBe(401);
      const student = await createUserWithPermissions([], ['student']);
      expect((await request(app).get(base).set(auth(student))).status).toBe(403);
    });

    it('requires catalogue.manage and a matching CSRF token for writes', async () => {
      const body = { code: 'non-academic', name: 'Non-academic' };
      expect((await send('post', `${base}/roots`, reader).send(body)).status).toBe(403);
      const noCsrf = await request(app).post(`${base}/roots`).set(auth(admin)).send(body);
      expect(noCsrf.status).toBe(403);
      expect(await prisma.category.count({ where: { code: 'non-academic' } })).toBe(0);
    });
  });

  describe('create', () => {
    it('creates a root and a child with path and depth from the parent', async () => {
      const root = await send('post', `${base}/roots`).send({
        code: 'non-academic',
        name: 'Non-academic',
      });
      expect(root.status).toBe(201);
      expect(root.body.data).toMatchObject({
        path: 'non-academic',
        depth: 0,
        parentId: null,
        breadcrumb: [],
      });

      const child = await send('post', `${base}/${root.body.data.id}/children`).send({
        code: 'skills',
        name: 'Skills',
      });
      expect(child.status).toBe(201);
      expect(child.body.data).toMatchObject({
        path: 'non-academic/skills',
        depth: 1,
        isBookable: false,
      });
      expect(child.body.data.breadcrumb.map((b: { name: string }) => b.name)).toEqual([
        'Non-academic',
      ]);
    });

    it('treats a retry with the same code and name as idempotent, and a clash as 409', async () => {
      const first = await send('post', `${base}/${school.id}/children`).send({
        code: 'competitive',
        name: 'Competitive',
      });
      const retry = await send('post', `${base}/${school.id}/children`).send({
        code: 'competitive',
        name: 'Competitive',
      });
      expect([first.status, retry.status]).toEqual([201, 200]);
      expect(retry.body.data.id).toBe(first.body.data.id);

      const clash = await send('post', `${base}/${school.id}/children`).send({
        code: 'competitive',
        name: 'Other',
      });
      expect(clash.status).toBe(409);
      expect(clash.body.code).toBe('DUPLICATE_CODE');
      // Same code is fine under another parent: codes are unique among siblings only
      expect(
        (
          await send('post', `${base}/${academic.id}/children`).send({
            code: 'competitive',
            name: 'Competitive',
          })
        ).status
      ).toBe(201);
    });

    it('refuses a child under a bookable leaf, in the service and in the database', async () => {
      const leaf = await createTreeNode(school, { code: 'cbse-only', isBookable: true });
      const res = await send('post', `${base}/${leaf.id}/children`).send({ code: 'x', name: 'X' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PARENT_IS_BOOKABLE');
      await expect(createTreeNode(leaf, { code: 'direct' })).rejects.toThrow();
    });

    it('rejects bad codes and an unknown parent without exposing database errors', async () => {
      const bad = await send('post', `${base}/roots`).send({ code: 'Bad Code', name: 'x' });
      expect(bad.status).toBe(422);
      const unknown = await send(
        'post',
        `${base}/00000000-0000-4000-8000-000000000000/children`
      ).send({ code: 'x', name: 'x' });
      expect(unknown.status).toBe(422);
      expect(unknown.body.code).toBe('PARENT_NOT_FOUND');
      expect(JSON.stringify(unknown.body)).not.toMatch(/prisma|stack|sql/i);
    });
  });

  describe('tree read', () => {
    it('lists every node with child and curricula counts and caches until the next write', async () => {
      await prisma.category.update({
        where: { id: k12.id },
        data: { isBookable: true, requiresLevel: false },
      });
      await createOffering({
        categoryId: k12.id,
        subjectId: lookups.subject.id,
        boardId: lookups.board.id,
      });

      const first = await request(app).get(base).set(auth(reader));
      expect(first.status).toBe(200);
      expect(first.headers['x-cache']).toBe('MISS');
      const byPath = new Map(first.body.data.nodes.map((n: { path: string }) => [n.path, n]));
      expect(byPath.get('academic/school')).toMatchObject({
        childrenCount: 1,
        curriculaCount: 0,
        subtreeCurriculaCount: 1,
      });
      expect(byPath.get('academic/school/k-12')).toMatchObject({
        childrenCount: 0,
        curriculaCount: 1,
        isBookable: true,
      });
      expect(first.body.data.stats).toMatchObject({
        categories: 3,
        bookableLeaves: 1,
        curricula: 1,
      });

      expect((await request(app).get(base).set(auth(reader))).headers['x-cache']).toBe('HIT');
      await send('patch', `${base}/${k12.id}`).send({
        version: (await node(k12.id)).version,
        name: 'K-12 (CBSE)',
      });
      const after = await request(app).get(base).set(auth(reader));
      expect(after.headers['x-cache']).toBe('MISS');
      expect(after.body.data.nodes.find((n: { id: string }) => n.id === k12.id).name).toBe(
        'K-12 (CBSE)'
      );
    });

    it('returns only direct children with parentId (lazy load)', async () => {
      const res = await request(app).get(`${base}?parentId=${school.id}`).set(auth(reader));
      expect(res.body.data.map((n: { code: string }) => n.code)).toEqual(['k-12']);
    });
  });

  describe('update', () => {
    it('rejects a stale version and accepts an idempotent retry', async () => {
      const v = (await node(school.id)).version;
      const ok = await send('patch', `${base}/${school.id}`).send({ version: v, name: 'Schools' });
      expect(ok.status).toBe(200);
      expect(ok.body.data.version).toBe(v + 1);

      const retry = await send('patch', `${base}/${school.id}`).send({
        version: v,
        name: 'Schools',
      });
      expect(retry.status).toBe(200);
      const stale = await send('patch', `${base}/${school.id}`).send({
        version: v,
        name: 'Something else',
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('STALE_VERSION');
      expect((await node(school.id)).name).toBe('Schools');
    });

    it('rebuilds the whole subtree path when a code changes', async () => {
      const physics = await createTreeNode(k12, { code: 'physics' });
      const res = await send('patch', `${base}/${school.id}`).send({
        version: (await node(school.id)).version,
        code: 'schools',
      });
      expect(res.status).toBe(200);
      expect((await node(k12.id)).path).toBe('academic/schools/k-12');
      expect((await node(physics.id)).path).toBe('academic/schools/k-12/physics');
      expect(await verify()).toEqual([]);
    });
  });

  describe('leaf settings', () => {
    it('saves the flags and allowed levels of a leaf', async () => {
      const res = await send('put', `${base}/${k12.id}/leaf-settings`).send({
        version: (await node(k12.id)).version,
        isBookable: true,
        requiresBoard: true,
        requiresLevel: true,
        levelIds: [lookups.level.id, lookups.level2.id],
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        isBookable: true,
        requiresBoard: true,
        requiresLevel: true,
      });
      expect(res.body.data.allowedLevels).toHaveLength(2);
    });

    it('enforces invariants 3, 4 and 5 with clear reasons', async () => {
      const settings = async (id: string, body: Record<string, unknown>) =>
        send('put', `${base}/${id}/leaf-settings`).send({
          version: (await node(id)).version,
          isBookable: true,
          requiresBoard: false,
          requiresLevel: true,
          levelIds: [lookups.level.id],
          ...body,
        });

      const branch = await settings(school.id, {});
      expect([branch.status, branch.body.code]).toEqual([409, 'HAS_CHILDREN']);
      expect(branch.body.message).toContain('1 sub-category');

      const noLevels = await settings(k12.id, { levelIds: [] });
      expect([noLevels.status, noLevels.body.code]).toEqual([422, 'LEVELS_REQUIRED']);

      expect((await settings(k12.id, {})).status).toBe(200);
      await createOffering({
        categoryId: k12.id,
        subjectId: lookups.subject.id,
        levelId: lookups.level.id,
      });

      const removeUsed = await settings(k12.id, { levelIds: [lookups.level2.id] });
      expect([removeUsed.status, removeUsed.body.code]).toEqual([409, 'LEVEL_IN_USE']);

      const unbook = await settings(k12.id, { isBookable: false });
      expect([unbook.status, unbook.body.code]).toEqual([409, 'CATEGORY_REFERENCED']);
      expect(unbook.body.message).toContain('1 curriculum');

      const needBoard = await settings(k12.id, { requiresBoard: true });
      expect([needBoard.status, needBoard.body.code]).toEqual([409, 'BOARD_REQUIRED_BY_CURRICULA']);
    });
  });

  describe('reorder', () => {
    it('reorders siblings without changing parents and rejects a stale list', async () => {
      const a = await createTreeNode(academic, { code: 'university', displayOrder: 2 });
      const b = await createTreeNode(academic, { code: 'jee-neet', displayOrder: 3 });
      const res = await send('put', `${base}/reorder`).send({
        parentId: academic.id,
        orderedIds: [b.id, a.id, school.id],
      });
      expect(res.status).toBe(200);
      expect(res.body.data.map((n: { code: string }) => n.code)).toEqual([
        'jee-neet',
        'university',
        'school',
      ]);
      expect((await node(a.id)).parentId).toBe(academic.id);

      const stale = await send('put', `${base}/reorder`).send({
        parentId: academic.id,
        orderedIds: [a.id, b.id],
      });
      expect([stale.status, stale.body.code]).toEqual([409, 'STALE_SIBLINGS']);
    });
  });

  describe('move', () => {
    it('moves a branch and rebuilds path and depth for the whole subtree in one transaction', async () => {
      const physics = await createTreeNode(k12, { code: 'physics' });
      const class11 = await createTreeNode(physics, { code: 'class-11' });
      const nonAcademic = await createTreeNode(null, { code: 'non-academic' });

      const res = await send('put', `${base}/${k12.id}/move`).send({
        version: (await node(k12.id)).version,
        parentId: nonAcademic.id,
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        path: 'non-academic/k-12',
        depth: 1,
        parentId: nonAcademic.id,
      });
      expect(await node(class11.id)).toMatchObject({
        path: 'non-academic/k-12/physics/class-11',
        depth: 3,
      });
      expect(await verify()).toEqual([]);

      // Retrying the same move is a no-op, even with the old version
      expect(
        (await send('put', `${base}/${k12.id}/move`).send({ version: 1, parentId: nonAcademic.id }))
          .status
      ).toBe(200);
      // Making it a root
      const root = await send('put', `${base}/${k12.id}/move`).send({
        version: (await node(k12.id)).version,
        parentId: null,
      });
      expect(root.body.data).toMatchObject({ path: 'k-12', depth: 0 });
      expect((await node(class11.id)).path).toBe('k-12/physics/class-11');
    });

    it('moves a node to an exact position among its new siblings in one transaction', async () => {
      const university = await createTreeNode(academic, { code: 'university', displayOrder: 2 });
      const jee = await createTreeNode(academic, { code: 'jee-neet', displayOrder: 3 });
      const res = await send('put', `${base}/${k12.id}/move`).send({
        version: (await node(k12.id)).version,
        parentId: academic.id,
        index: 1,
      });
      expect(res.status).toBe(200);
      const order = await prisma.category.findMany({
        where: { parentId: academic.id },
        orderBy: { displayOrder: 'asc' },
      });
      expect(order.map((c) => c.code)).toEqual(['school', 'k-12', 'university', 'jee-neet']);
      expect(order.map((c) => c.displayOrder)).toEqual([1, 2, 3, 4]);
      expect(university.id).toBeTruthy();
      expect(jee.id).toBeTruthy();
      // An index past the end places it last
      const last = await send('put', `${base}/${k12.id}/move`).send({
        version: (await node(k12.id)).version,
        parentId: school.id,
        index: 99,
      });
      expect(last.body.data).toMatchObject({ parentId: school.id, path: 'academic/school/k-12' });
      expect(await verify()).toEqual([]);
    });

    it('blocks cycles, bookable parents, code clashes and stale versions', async () => {
      const physics = await createTreeNode(k12, { code: 'physics' });
      const v = (await node(school.id)).version;
      const intoSelf = await send('put', `${base}/${school.id}/move`).send({
        version: v,
        parentId: school.id,
      });
      const intoChild = await send('put', `${base}/${school.id}/move`).send({
        version: v,
        parentId: physics.id,
      });
      expect([intoSelf.body.code, intoChild.body.code]).toEqual(['CYCLE', 'CYCLE']);
      expect(intoChild.status).toBe(422);

      const leaf = await createTreeNode(academic, { code: 'leaf', isBookable: true });
      const intoLeaf = await send('put', `${base}/${physics.id}/move`).send({
        version: (await node(physics.id)).version,
        parentId: leaf.id,
      });
      expect([intoLeaf.status, intoLeaf.body.code]).toEqual([409, 'PARENT_IS_BOOKABLE']);

      await createTreeNode(academic, { code: 'physics' });
      const clash = await send('put', `${base}/${physics.id}/move`).send({
        version: (await node(physics.id)).version,
        parentId: academic.id,
      });
      expect([clash.status, clash.body.code]).toEqual([409, 'DUPLICATE_CODE']);

      const stale = await send('put', `${base}/${physics.id}/move`).send({
        version: 99,
        parentId: school.id,
      });
      expect([stale.status, stale.body.code]).toEqual([409, 'STALE_VERSION']);
      expect((await node(physics.id)).path).toBe('academic/school/k-12/physics');
    });
  });

  describe('delete (invariant 7)', () => {
    it('blocks deleting a node with children or references and explains why', async () => {
      const res = await send(
        'delete',
        `${base}/${school.id}?version=${(await node(school.id)).version}`
      );
      expect([res.status, res.body.code]).toEqual([409, 'DELETE_BLOCKED']);
      expect(res.body.message).toBe(
        'School cannot be deleted because it has 1 sub-category. Deactivate it instead.'
      );

      await prisma.category.update({
        where: { id: k12.id },
        data: { isBookable: true, requiresLevel: false },
      });
      await createOffering({
        categoryId: k12.id,
        subjectId: lookups.subject.id,
        boardId: lookups.board.id,
      });
      const referenced = await send(
        'delete',
        `${base}/${k12.id}?version=${(await node(k12.id)).version}`
      );
      expect(referenced.body.message).toContain('1 curriculum');
    });

    it('deletes an unreferenced leaf and checks the version', async () => {
      const empty = await createTreeNode(academic, { code: 'empty' });
      expect((await send('delete', `${base}/${empty.id}?version=7`)).body.code).toBe(
        'STALE_VERSION'
      );
      expect((await send('delete', `${base}/${empty.id}?version=${empty.version}`)).status).toBe(
        204
      );
      expect(await prisma.category.count({ where: { id: empty.id } })).toBe(0);
      expect((await send('delete', `${base}/${empty.id}?version=1`)).status).toBe(404);
    });
  });

  describe('concurrency', () => {
    it('lets exactly one of two edits based on the same version win', async () => {
      const v = (await node(school.id)).version;
      const results = await Promise.all([
        send('patch', `${base}/${school.id}`).send({ version: v, name: 'First' }),
        send('patch', `${base}/${school.id}`).send({ version: v, name: 'Second' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await node(school.id)).version).toBe(v + 1);
    });

    it('keeps the tree consistent when a move races a child insert in the moved subtree', async () => {
      const nonAcademic = await createTreeNode(null, { code: 'non-academic' });
      for (let i = 0; i < 5; i += 1) {
        const target = i % 2 === 0 ? nonAcademic : academic;
        await Promise.all([
          send('put', `${base}/${school.id}/move`).send({
            version: (await node(school.id)).version,
            parentId: target.id,
          }),
          send('post', `${base}/${k12.id}/children`).send({ code: `sub-${i}`, name: `Sub ${i}` }),
        ]);
      }
      expect(await verify()).toEqual([]);
      const subs = await prisma.category.findMany({ where: { parentId: k12.id } });
      const k12Path = (await node(k12.id)).path;
      for (const s of subs) expect(s.path).toBe(`${k12Path}/${s.code}`);
    });

    it('never ends with children under a bookable node when both happen at once', async () => {
      const v = (await node(k12.id)).version;
      const [book, child] = await Promise.all([
        send('put', `${base}/${k12.id}/leaf-settings`).send({
          version: v,
          isBookable: true,
          requiresBoard: false,
          requiresLevel: false,
          levelIds: [],
        }),
        send('post', `${base}/${k12.id}/children`).send({ code: 'late', name: 'Late' }),
      ]);
      expect([book.status, child.status]).toContain(200);
      expect(await verify()).toEqual([]);
    });
  });

  describe('database invariants', () => {
    it('rejects a path that does not match the parent and a curriculum on a non-bookable category', async () => {
      await expect(
        prisma.category.create({
          data: { parentId: school.id, code: 'bad', name: 'Bad', path: 'elsewhere/bad', depth: 2 },
        })
      ).rejects.toThrow();
      await expect(
        createOffering({
          categoryId: school.id,
          subjectId: lookups.subject.id,
          boardId: lookups.board.id,
        })
      ).rejects.toThrow();
    });

    it('rejects a level the leaf does not allow and a missing required board', async () => {
      await prisma.category.update({
        where: { id: k12.id },
        data: { isBookable: true, requiresLevel: true },
      });
      await allowLevels(k12.id, [lookups.level.id]);
      await expect(
        createOffering({
          categoryId: k12.id,
          subjectId: lookups.subject.id,
          boardId: lookups.board.id,
          levelId: lookups.level2.id,
        })
      ).rejects.toThrow();
      await expect(
        createOffering({
          categoryId: k12.id,
          subjectId: lookups.subject.id,
          levelId: lookups.level.id,
        })
      ).rejects.toThrow();
      await expect(
        createOffering({
          categoryId: k12.id,
          subjectId: lookups.subject.id,
          boardId: lookups.board.id,
          levelId: lookups.level.id,
        })
      ).resolves.toBeTruthy();
    });
  });

  describe('offerings', () => {
    beforeEach(async () => {
      await prisma.category.update({
        where: { id: k12.id },
        data: { isBookable: true, requiresLevel: true },
      });
      await allowLevels(k12.id, [lookups.level.id]);
    });

    it('adds an offering idempotently and applies the leaf rules', async () => {
      const body = {
        subjectId: lookups.subject.id,
        boardId: lookups.board.id,
        levelId: lookups.level.id,
      };
      const first = await send('post', `${base}/${k12.id}/offerings`).send(body);
      const again = await send('post', `${base}/${k12.id}/offerings`).send(body);
      expect([first.status, again.status]).toEqual([201, 200]);
      expect(again.body.data.curriculumId).toBe(first.body.data.curriculumId);

      const noBoard = await send('post', `${base}/${k12.id}/offerings`).send({
        subjectId: lookups.subject.id,
        levelId: lookups.level.id,
      });
      expect([noBoard.status, noBoard.body.code]).toEqual([422, 'BOARD_REQUIRED']);
      const wrongLevel = await send('post', `${base}/${k12.id}/offerings`).send({
        ...body,
        levelId: lookups.level2.id,
      });
      expect(wrongLevel.body.code).toBe('LEVEL_NOT_ALLOWED');
      const branch = await send('post', `${base}/${school.id}/offerings`).send(body);
      expect(branch.body.code).toBe('NOT_BOOKABLE');

      const list = await request(app).get(`${base}/${k12.id}/offerings`).set(auth(reader));
      expect(list.body.data).toHaveLength(1);
    });
  });

  describe('learner catalogue', () => {
    const learner = '/api/v1/catalogue/category-tree';
    let university: TreeNodeFixture;

    beforeEach(async () => {
      await prisma.category.update({
        where: { id: k12.id },
        data: { isBookable: true, requiresLevel: true },
      });
      await allowLevels(k12.id, [lookups.level.id]);
      await createOffering({
        categoryId: k12.id,
        subjectId: lookups.subject.id,
        boardId: lookups.board.id,
        levelId: lookups.level.id,
      });
      university = await createTreeNode(academic, {
        code: 'university',
        name: 'University',
        isBookable: true,
        requiresLevel: false,
      });
      await createOffering({ categoryId: university.id, subjectId: lookups.subject2.id });
      await createTreeNode(academic, { code: 'empty-branch', name: 'Empty' });
      await setFlag('catalogue.category_tree', true);
    });

    it('is switched off by the feature flag', async () => {
      await setFlag('catalogue.category_tree', false);
      const res = await request(app).get(`${learner}/children`);
      expect([res.status, res.body.code]).toEqual([404, 'FEATURE_DISABLED']);
    });

    it('navigates root → tier → leaf and hides branches with nothing bookable', async () => {
      const roots = await request(app).get(`${learner}/children`);
      expect(roots.body.data.map((n: { code: string }) => n.code)).toEqual(['academic']);
      const tiers = await request(app).get(`${learner}/children?parentId=${academic.id}`);
      expect(
        tiers.body.data.map((n: { code: string; isLeaf: boolean }) => [n.code, n.isLeaf])
      ).toEqual([
        ['school', false],
        ['university', true],
      ]);
    });

    it('hides every descendant of a deactivated node (invariant 8)', async () => {
      await prisma.category.update({ where: { id: school.id }, data: { isActive: false } });
      const leaves = await request(app).get(`${learner}/leaves`);
      expect(leaves.body.data.map((n: { code: string }) => n.code)).toEqual(['university']);
      expect((await request(app).get(`${learner}/leaves/${k12.id}`)).status).toBe(404);
    });

    it('shows the board and level fields only when the leaf requires them', async () => {
      const k12Leaf = await request(app).get(`${learner}/leaves/${k12.id}`);
      expect(k12Leaf.body.data).toMatchObject({ requiresBoard: true, requiresLevel: true });
      expect(k12Leaf.body.data.boards).toHaveLength(1);
      expect(k12Leaf.body.data.levels.map((l: { id: string }) => l.id)).toEqual([lookups.level.id]);
      expect(k12Leaf.body.data.breadcrumb.map((b: { name: string }) => b.name)).toEqual([
        'Academic',
        'School',
      ]);

      const uni = await request(app).get(`${learner}/leaves/${university.id}`);
      expect(uni.body.data).toMatchObject({
        requiresBoard: false,
        requiresLevel: false,
        boards: [],
        levels: [],
      });
      expect(uni.body.data.subjects.map((s: { id: string }) => s.id)).toEqual([
        lookups.subject2.id,
      ]);
    });

    it('resolves a choice to a curriculum, with and without board and level', async () => {
      const withAll = await request(app).get(
        `${learner}/leaves/${k12.id}/offering?subjectId=${lookups.subject.id}&boardId=${lookups.board.id}&levelId=${lookups.level.id}`
      );
      expect(withAll.status).toBe(200);
      expect(withAll.body.data.categoryPath).toBe('academic/school/k-12');

      const missingBoard = await request(app).get(
        `${learner}/leaves/${k12.id}/offering?subjectId=${lookups.subject.id}&levelId=${lookups.level.id}`
      );
      expect([missingBoard.status, missingBoard.body.code]).toEqual([422, 'BOARD_REQUIRED']);

      const none = await request(app).get(
        `${learner}/leaves/${university.id}/offering?subjectId=${lookups.subject2.id}`
      );
      expect(none.status).toBe(200);
      const nothing = await request(app).get(
        `${learner}/leaves/${university.id}/offering?subjectId=${lookups.subject.id}`
      );
      expect([nothing.status, nothing.body.code]).toEqual([404, 'NO_OFFERING']);
    });

    it('paginates leaves and filters by branch and name', async () => {
      const page = await request(app).get(`${learner}/leaves?limit=1`);
      expect(page.body.meta).toMatchObject({ total: 2, totalPages: 2 });
      const under = await request(app).get(`${learner}/leaves?under=${school.id}`);
      expect(under.body.data.map((n: { code: string }) => n.code)).toEqual(['k-12']);
      const named = await request(app).get(`${learner}/leaves?q=univ`);
      expect(named.body.data.map((n: { code: string }) => n.code)).toEqual(['university']);
    });
  });

  it('audits every write with the acting admin', async () => {
    await send('patch', `${base}/${school.id}`).send({
      version: (await node(school.id)).version,
      name: 'Schools',
    });
    const entry = await prisma.auditLog.findFirst({
      where: { action: 'category.update', resourceId: school.id },
    });
    expect(entry?.actorId).toBe(admin.userId);
  });
});
