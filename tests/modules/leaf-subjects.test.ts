import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { createUserWithPermissions } from '../helpers/auth.js';
import {
  createLookups,
  createTreeNode,
  priceCurriculum,
  type TreeNodeFixture,
} from '../helpers/category-tree.js';
import { prisma } from '@infrastructure/database/index.js';

// 20261110090000_leaf_subject_offerings: a leaf's offerings are its subjects.
describe('Leaf subjects', () => {
  let csrf: { csrfToken: string; csrfCookie: string };
  let admin: { userId: string; token: string };
  let reader: { userId: string; token: string };
  let branch: TreeNodeFixture;
  let leaf: TreeNodeFixture;
  let lookups: Awaited<ReturnType<typeof createLookups>>;

  const base = '/api/v1/admin/category-tree';
  const auth = (user: { token: string }) => ({ Authorization: `Bearer ${user.token}` });
  const send = (method: 'post' | 'patch' | 'delete', url: string, user = admin) =>
    request(app)
      [method](url)
      .set(auth(user))
      .set('Cookie', csrf.csrfCookie)
      .set('x-csrf-token', csrf.csrfToken);

  beforeEach(async () => {
    csrf = await getCsrfData();
    admin = await createUserWithPermissions(['catalogue.read', 'catalogue.manage']);
    reader = await createUserWithPermissions(['catalogue.read']);
    const academic = await createTreeNode(null, { code: 'academic', name: 'Academic' });
    branch = await createTreeNode(academic, { code: 'school', name: 'School' });
    leaf = await createTreeNode(branch, { code: 'class-11', name: 'Class 11' });
    lookups = await createLookups();
  });

  it('adds an existing subject once and lists it with its usage', async () => {
    const url = `${base}/${leaf.id}/subjects`;
    const first = await send('post', url).send({ subjectId: lookups.subject.id });
    expect(first.status).toBe(201);
    const again = await send('post', url).send({ subjectId: lookups.subject.id });
    expect(again.status).toBe(200);
    expect(again.body.data.curriculumId).toBe(first.body.data.curriculumId);

    const list = await request(app).get(url).set(auth(reader));
    expect(list.body.data).toEqual([
      expect.objectContaining({
        subjectId: lookups.subject.id,
        isActive: true,
        tutors: 0,
        prices: 0,
        learners: 0,
      }),
    ]);
  });

  it('creates a subject by name, and reuses it for the same name', async () => {
    const a = await send('post', `${base}/${leaf.id}/subjects`).send({ name: 'Applied Maths' });
    expect(a.status).toBe(201);
    const other = await createTreeNode(branch, { code: 'class-12', name: 'Class 12' });
    const b = await send('post', `${base}/${other.id}/subjects`).send({ name: 'applied  maths' });
    expect(b.body.data.subjectId).toBe(a.body.data.subjectId);
    expect(await prisma.subject.count({ where: { code: 'applied-maths' } })).toBe(1);
  });

  it('refuses a category that has sub-categories, an unknown subject and a reader', async () => {
    const onBranch = await send('post', `${base}/${branch.id}/subjects`).send({
      subjectId: lookups.subject.id,
    });
    expect(onBranch.status).toBe(422);
    expect(onBranch.body.code).toBe('NOT_A_LEAF');
    const unknown = await send('post', `${base}/${leaf.id}/subjects`).send({
      subjectId: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.body.code).toBe('UNKNOWN_SUBJECT');
    const denied = await send('post', `${base}/${leaf.id}/subjects`, reader).send({
      subjectId: lookups.subject.id,
    });
    expect(denied.status).toBe(403);
  });

  it('removes an unused subject but protects one that is priced', async () => {
    const attached = await send('post', `${base}/${leaf.id}/subjects`).send({
      subjectId: lookups.subject.id,
    });
    const url = `${base}/${leaf.id}/subjects/${lookups.subject.id}`;
    await priceCurriculum(attached.body.data.curriculumId);
    const blocked = await send('delete', url);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('OFFERING_IN_USE');

    await prisma.priceRule.deleteMany({ where: { curriculumId: attached.body.data.curriculumId } });
    expect((await send('delete', url)).status).toBe(204);
    expect((await send('delete', url)).body.code).toBe('OFFERING_NOT_FOUND');
  });

  it('switches an offering off and back on', async () => {
    await send('post', `${base}/${leaf.id}/subjects`).send({ subjectId: lookups.subject.id });
    const url = `${base}/${leaf.id}/subjects/${lookups.subject.id}`;
    expect((await send('patch', url).send({ isActive: false })).status).toBe(200);
    const row = await prisma.curriculum.findFirstOrThrow({ where: { categoryId: leaf.id } });
    expect(row.isActive).toBe(false);
    const again = await send('post', `${base}/${leaf.id}/subjects`).send({
      subjectId: lookups.subject.id,
    });
    expect(again.status).toBe(200);
    expect((await prisma.curriculum.findUniqueOrThrow({ where: { id: row.id } })).isActive).toBe(true);
  });

  it('shows a leaf in the tutor picker only once it offers an active subject', async () => {
    const picker = () => request(app).get(`${base}/picker`).set(auth(reader));
    expect((await picker()).body.data.offerings).toEqual([]);
    await send('post', `${base}/${leaf.id}/subjects`).send({ subjectId: lookups.subject.id });
    const { offerings } = (await picker()).body.data;
    expect(offerings).toEqual([
      expect.objectContaining({
        categoryId: leaf.id,
        subject: { id: lookups.subject.id, name: lookups.subject.name },
        board: null,
        level: null,
      }),
    ]);
  });

  it('refuses sub-categories under a leaf whose subject is in use', async () => {
    const attached = await send('post', `${base}/${leaf.id}/subjects`).send({
      subjectId: lookups.subject.id,
    });
    await priceCurriculum(attached.body.data.curriculumId);
    const child = await send('post', `${base}/${leaf.id}/children`).send({ code: 'x', name: 'X' });
    expect(child.status).toBe(409);
    expect(child.body.code).toBe('CATEGORY_IN_USE');
  });
});
