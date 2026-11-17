import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { loginWithRole } from '../helpers/users.js';
import { expectContractResponse } from '../helpers/contract.js';
import { PDF } from '../helpers/onboarding.js';
import { createOfferings, signedInTutor, type Tutor } from '../helpers/subject-cards.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';
import { getTestStorage } from '../../src/infrastructure/storage/index.js';

const API = '/api/v1';

describe('Student library', () => {
  let csrf: Awaited<ReturnType<typeof getCsrfData>>;
  let adminToken: string;
  let studentToken: string;
  let offerings: { id: string }[];
  let tutor: Tutor;

  beforeEach(async () => {
    await seedRbac(prisma);
    csrf = await getCsrfData();
    getTestStorage().clear();
    offerings = await createOfferings(2);
    ({ token: adminToken } = await loginWithRole('admin', 'lib-admin@example.com'));
    ({ token: studentToken } = await loginWithRole('student', 'lib-student@example.com'));
    tutor = await signedInTutor('lib-tutor@example.com', [offerings[0]!.id]);
    // Approving a tutor publishes the profile
    await prisma.facultyProfile.update({
      where: { id: tutor.facultyId },
      data: { isPublished: true },
    });
  });

  const get = (path: string, token = studentToken) =>
    request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`);
  const withCsrf = (req: request.Test, token: string) =>
    req
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', csrf.csrfCookie)
      .set('x-csrf-token', csrf.csrfToken);

  const addNote = (title: string, body = 'Torque is force times distance. '.repeat(5)) =>
    withCsrf(request(app).post(`${API}/faculty/me/library/resources`), tutor.token)
      .field('curriculumId', offerings[0]!.id)
      .field('kind', 'note')
      .field('title', title)
      .field('body', body);
  const addFile = (title: string) =>
    withCsrf(request(app).post(`${API}/faculty/me/library/resources`), tutor.token)
      .field('curriculumId', offerings[0]!.id)
      .field('kind', 'file')
      .field('title', title)
      .attach('file', PDF, { filename: 'torque.pdf' });
  async function approve(resourceId: string) {
    const sub = await prisma.libraryMaterialRevision.findFirstOrThrow({
      where: { materialId: resourceId, status: 'PENDING' },
    });
    const res = await withCsrf(
      request(app).put(`${API}/admin/library/${sub.id}/review`),
      adminToken
    ).send({ status: 'approved' });
    expect(res.status).toBe(200);
  }
  const published = async (title: string, make = addFile) => {
    const created = await make(title);
    expect(created.status).toBe(201);
    await approve(created.body.data.id);
    return created.body.data.id as string;
  };

  it('shows only approved resources, with subject tabs and the contract shapes', async () => {
    const live = await published('Rotational motion');
    await addFile('Still waiting');

    const list = await get('/library');
    expect(list.status).toBe(200);
    expectContractResponse(list, 'get', '/library');
    expect(list.body.data.map((r: { title: string }) => r.title)).toEqual(['Rotational motion']);
    expect(list.body.data[0]).toMatchObject({ id: live, type: 'pdf', readMinutes: null });
    expect(list.body.data[0].sizeBytes).toBeGreaterThan(0);

    const subjects = await get('/library/subjects');
    expectContractResponse(subjects, 'get', '/library/subjects');
    expect(subjects.body.data).toHaveLength(1);
    expect(subjects.body.data[0].count).toBe(1);
  });

  it('filters by subject, searches, sorts and pages', async () => {
    await published('Alpha notes', addNote);
    await published('Beta sheet');
    const subjectId = (await get('/library/subjects')).body.data[0].id as string;

    expect((await get(`/library?subjectId=${subjectId}`)).body.data).toHaveLength(2);
    expect(
      (await get('/library?subjectId=00000000-0000-4000-8000-000000000000')).body.data
    ).toEqual([]);
    expect((await get('/library?q=beta')).body.data.map((r: { title: string }) => r.title)).toEqual(
      ['Beta sheet']
    );
    const byTitle = await get('/library?sort=title&limit=1&page=2');
    expect(byTitle.body.data.map((r: { title: string }) => r.title)).toEqual(['Beta sheet']);
    expect(byTitle.body.meta.total).toBe(2);
  });

  it('reads a note with its text and related resources, and downloads a file', async () => {
    const note = await published('A note', addNote);
    const file = await published('A file');

    const detail = await get(`/library/${note}`);
    expect(detail.status).toBe(200);
    expectContractResponse(detail, 'get', '/library/{resourceId}');
    expect(detail.body.data).toMatchObject({ type: 'note', file: null });
    expect(detail.body.data.readMinutes).toBeGreaterThanOrEqual(1);
    expect(detail.body.data.body).toContain('Torque');
    expect(detail.body.data.related.map((r: { id: string }) => r.id)).toEqual([file]);

    const download = await get(`/library/${file}/file`);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toContain('attachment');

    expect((await get(`/library/${note}/file`)).status).toBe(404);
  });

  it('keeps the approved version live while an edit waits, and hides it when the faculty is deactivated', async () => {
    const id = await published('Original title', addNote);
    const edit = await withCsrf(
      request(app).put(`${API}/faculty/me/library/resources/${id}`),
      tutor.token
    )
      .field('kind', 'note')
      .field('title', 'Edited title')
      .field('body', 'New text');
    expect(edit.status).toBe(200);
    expect((await get(`/library/${id}`)).body.data.title).toBe('Original title');

    await prisma.facultyProfile.updateMany({ data: { isActive: false } });
    expect((await get(`/library/${id}`)).status).toBe(404);
    expect((await get('/library')).body.data).toEqual([]);
  });

  it('is for signed-in students only', async () => {
    expect((await request(app).get(`${API}/library`)).status).toBe(401);
    expect((await get('/library', adminToken)).status).toBe(403);
    expect((await get('/library', tutor.token)).status).toBe(403);
    expect((await get('/library/not-a-uuid')).status).toBe(422);
  });
});
