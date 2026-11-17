import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { loginWithRole } from '../helpers/users.js';
import { expectContractResponse } from '../helpers/contract.js';
import { PDF, PNG } from '../helpers/onboarding.js';
import { createOfferings, signedInTutor, type Tutor } from '../helpers/subject-cards.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';
import { getTestStorage } from '../../src/infrastructure/storage/index.js';

const API = '/api/v1';
type Csrf = { csrfToken: string; csrfCookie: string };

describe('Faculty library and admin review (Workflow B)', () => {
  let csrf: Csrf;
  let adminToken: string;
  let offerings: { id: string }[];
  let tutor: Tutor;

  beforeEach(async () => {
    await seedRbac(prisma);
    csrf = await getCsrfData();
    getTestStorage().clear();
    offerings = await createOfferings(3);
    ({ token: adminToken } = await loginWithRole('admin', 'library-admin@example.com'));
    tutor = await signedInTutor('library-tutor@example.com', [offerings[0]!.id]);
  });

  const get = (path: string, token: string) =>
    request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`);
  const withCsrf = (req: request.Test, token: string) =>
    req
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', csrf.csrfCookie)
      .set('x-csrf-token', csrf.csrfToken);

  function submit(
    fields: Record<string, string>,
    file?: [Buffer, string],
    options: { resourceId?: string; token?: string } = {}
  ) {
    const req = withCsrf(
      options.resourceId
        ? request(app).put(`${API}/faculty/me/library/resources/${options.resourceId}`)
        : request(app).post(`${API}/faculty/me/library/resources`),
      options.token ?? tutor.token
    );
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    if (file) req.attach('file', file[0], { filename: file[1] });
    return req;
  }
  const addFile = (title = 'Kinematics notes', curriculumId = offerings[0]!.id) =>
    submit({ curriculumId, kind: 'file', title, description: 'Chapter 3' }, [
      PDF,
      'kinematics.pdf',
    ]);
  const reviewAs = (submissionId: string, body: unknown, token = adminToken) =>
    withCsrf(request(app).put(`${API}/admin/library/${submissionId}/review`), token).send(
      body as object
    );
  const pendingSubmission = async (resourceId: string) =>
    prisma.libraryMaterialRevision.findFirstOrThrow({
      where: { materialId: resourceId, status: 'PENDING' },
    });

  it('adds a file resource as pending, listed on the card and in the review queue', async () => {
    const res = await addFile();
    expect(res.status).toBe(201);
    expectContractResponse(res, 'post', '/faculty/me/library/resources');
    expect(res.body.data).toMatchObject({
      kind: 'file',
      title: 'Kinematics notes',
      reviewState: 'pending',
      file: { name: 'kinematics.pdf', mimeType: 'application/pdf', previewable: true },
    });

    const overview = await get('/faculty/me/library', tutor.token);
    expectContractResponse(overview, 'get', '/faculty/me/library');
    expect(overview.body.data.cards[0]).toMatchObject({
      libraryEnabled: true,
      counts: { approved: 0, inReview: 1, rejected: 0 },
    });

    const list = await get(
      `/faculty/me/library/resources?curriculumId=${offerings[0]!.id}`,
      tutor.token
    );
    expectContractResponse(list, 'get', '/faculty/me/library/resources');
    expect(list.body.data).toHaveLength(1);

    const queue = await get('/admin/library', adminToken);
    expect(queue.status).toBe(200);
    expectContractResponse(queue, 'get', '/admin/library');
    expect(queue.body.data[0]).toMatchObject({
      status: 'pending',
      isEdit: false,
      title: 'Kinematics notes',
      faculty: { id: tutor.facultyId, email: 'library-tutor@example.com' },
      card: { curriculumId: offerings[0]!.id },
    });
    const counts = await get('/admin/library/counts', adminToken);
    expectContractResponse(counts, 'get', '/admin/library/counts');
    expect(counts.body.data).toEqual({ pending: 1, approved: 0, rejected: 0 });
  });

  it('adds a note, and validates the content', async () => {
    const note = await submit({
      curriculumId: offerings[0]!.id,
      kind: 'note',
      title: 'Formulae',
      body: 'v = u + at',
    });
    expect(note.status).toBe(201);
    expect(note.body.data).toMatchObject({ kind: 'note', body: 'v = u + at', file: null });

    const emptyNote = await submit({
      curriculumId: offerings[0]!.id,
      kind: 'note',
      title: 'Empty',
    });
    expect(emptyNote.status).toBe(422);
    const noFile = await submit({ curriculumId: offerings[0]!.id, kind: 'file', title: 'No file' });
    expect(noFile.status).toBe(422);
    expect(noFile.body.code).toBe('RESOURCE_INVALID');
    const badFile = await submit(
      { curriculumId: offerings[0]!.id, kind: 'file', title: 'Script' },
      [Buffer.from('#!/bin/sh\necho hi\n'), 'notes.pdf']
    );
    expect(badFile.status).toBe(422);
    expect(badFile.body.code).toBe('RESOURCE_INVALID');
  });

  it('refuses resources under a card that is not approved and active', async () => {
    const added = await withCsrf(
      request(app).post(`${API}/faculty/me/subject-cards`),
      tutor.token
    ).send({
      curriculumId: offerings[1]!.id,
    });
    expect(added.status).toBe(201);
    const res = await addFile('Pending card', offerings[1]!.id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUBJECT_CARD_NOT_ACTIVE');
    const notMine = await addFile('Not my card', offerings[2]!.id);
    expect(notMine.status).toBe(403);

    // An existing resource cannot be edited once its card is switched off
    const created = await addFile();
    await prisma.facultyAssignment.updateMany({
      where: { facultyId: tutor.facultyId, curriculumId: offerings[0]!.id },
      data: { isActive: false },
    });
    const edit = await submit({ kind: 'note', title: 'Changed', body: 'x' }, undefined, {
      resourceId: created.body.data.id,
    });
    expect(edit.status).toBe(403);
    expect(edit.body.code).toBe('SUBJECT_CARD_NOT_ACTIVE');
  });

  it('approves a new resource, then reviews an edit while the approved version stays live', async () => {
    const created = await addFile();
    const id = created.body.data.id as string;
    const first = await pendingSubmission(id);

    const approved = await reviewAs(first.id, { status: 'approved' });
    expect(approved.status).toBe(200);
    expectContractResponse(approved, 'put', '/admin/library/{submissionId}/review');
    expect(approved.body.data.status).toBe('approved');

    // Edit: replace the file and the title
    const edited = await submit({ kind: 'file', title: 'Kinematics v2' }, [PNG, 'diagram.png'], {
      resourceId: id,
    });
    expect(edited.status).toBe(200);
    expectContractResponse(edited, 'put', '/faculty/me/library/resources/{resourceId}');
    expect(edited.body.data).toMatchObject({
      reviewState: 'edit_pending',
      title: 'Kinematics notes',
      file: { name: 'kinematics.pdf' },
      pendingEdit: {
        title: 'Kinematics v2',
        revision: 2,
        file: { name: 'diagram.png', mimeType: 'image/png' },
      },
    });
    const live = await prisma.libraryMaterial.findUniqueOrThrow({ where: { id } });
    expect(live).toMatchObject({ status: 'APPROVED', title: 'Kinematics notes', revision: 1 });

    const second = await pendingSubmission(id);
    const detail = await get(`/admin/library/${second.id}`, adminToken);
    expectContractResponse(detail, 'get', '/admin/library/{submissionId}');
    expect(detail.body.data).toMatchObject({
      isEdit: true,
      live: { title: 'Kinematics notes', revision: 1 },
    });

    const noReason = await reviewAs(second.id, { status: 'rejected' });
    expect(noReason.status).toBe(422);
    const rejected = await reviewAs(second.id, {
      status: 'rejected',
      reason: 'The diagram is unreadable',
    });
    expect(rejected.status).toBe(200);
    const afterReject = await get(
      `/faculty/me/library/resources?curriculumId=${offerings[0]!.id}`,
      tutor.token
    );
    expect(afterReject.body.data[0]).toMatchObject({
      reviewState: 'edit_rejected',
      title: 'Kinematics notes',
      lastDecision: { decision: 'rejected', notes: 'The diagram is unreadable', revision: 2 },
    });

    // A further edit is approved and replaces the live version
    await submit({ kind: 'file', title: 'Kinematics v3' }, [PNG, 'clear.png'], { resourceId: id });
    const third = await pendingSubmission(id);
    expect(third.revision).toBe(3);
    expect((await reviewAs(third.id, { status: 'approved' })).status).toBe(200);
    expect(await prisma.libraryMaterial.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'APPROVED',
      title: 'Kinematics v3',
      originalFileName: 'clear.png',
      revision: 3,
    });
    expect(await prisma.libraryReview.count({ where: { materialId: id } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: 'library.submission_approved' } })).toBe(
      2
    );
  });

  it('a newer edit replaces one waiting for review; a never-approved rejection can be fixed', async () => {
    const created = await addFile();
    const id = created.body.data.id as string;
    const first = await pendingSubmission(id);

    // Edited before review: the first submission is superseded, the file is kept
    const edited = await submit({ kind: 'file', title: 'Renamed' }, undefined, { resourceId: id });
    expect(edited.body.data).toMatchObject({
      reviewState: 'pending',
      title: 'Renamed',
      file: { name: 'kinematics.pdf' },
    });
    const stale = await reviewAs(first.id, { status: 'approved' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('SUBMISSION_ALREADY_DECIDED');

    const second = await pendingSubmission(id);
    await reviewAs(second.id, { status: 'rejected', reason: 'Add a description' });
    const list = await get(
      `/faculty/me/library/resources?curriculumId=${offerings[0]!.id}`,
      tutor.token
    );
    expect(list.body.data[0]).toMatchObject({
      reviewState: 'rejected',
      lastDecision: { notes: 'Add a description' },
    });
    expect((await get('/admin/library/counts', adminToken)).body.data).toEqual({
      pending: 0,
      approved: 0,
      rejected: 1,
    });

    const fixed = await submit(
      { kind: 'note', title: 'Renamed', body: 'Now a note', description: 'Described' },
      undefined,
      {
        resourceId: id,
      }
    );
    expect(fixed.body.data).toMatchObject({ reviewState: 'pending', kind: 'note', file: null });
  });

  it('keeps tutors to their own resources', async () => {
    const created = await addFile();
    const other = await signedInTutor('library-other@example.com', [offerings[1]!.id]);
    const id = created.body.data.id as string;
    expect(
      (await get(`/faculty/me/library/resources?curriculumId=${offerings[0]!.id}`, other.token))
        .status
    ).toBe(404);
    const edit = await submit({ kind: 'note', title: 'Hijack', body: 'x' }, undefined, {
      resourceId: id,
      token: other.token,
    });
    expect(edit.status).toBe(404);
    expect((await get(`/faculty/me/library/resources/${id}/file`, other.token)).status).toBe(404);
    const withdraw = await withCsrf(
      request(app).delete(`${API}/faculty/me/library/resources/${id}`),
      other.token
    );
    expect(withdraw.status).toBe(404);
  });

  it('serves files as protected attachments to the tutor and the admin', async () => {
    const created = await addFile();
    const id = created.body.data.id as string;
    const own = await get(`/faculty/me/library/resources/${id}/file`, tutor.token);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('application/pdf');
    expect(own.headers['content-disposition']).toMatch(/^attachment/);
    expect(own.headers['x-document-previewable']).toBe('true');
    expect(own.headers['content-security-policy']).toContain('sandbox');

    const submission = await pendingSubmission(id);
    const admin = await get(`/admin/library/${submission.id}/content`, adminToken);
    expect(admin.status).toBe(200);
    expect(Buffer.from(admin.body as Buffer).equals(PDF)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'library.file_viewed' } })).toBe(1);
    expect(
      (await get(`/admin/library/${submission.id}/content?version=live`, adminToken)).status
    ).toBe(404);
  });

  it('withdraws a resource from the library and the queue', async () => {
    const created = await addFile();
    const id = created.body.data.id as string;
    const res = await withCsrf(
      request(app).delete(`${API}/faculty/me/library/resources/${id}`),
      tutor.token
    );
    expect(res.status).toBe(200);
    expectContractResponse(res, 'delete', '/faculty/me/library/resources/{resourceId}');
    expect(
      (await get(`/faculty/me/library/resources?curriculumId=${offerings[0]!.id}`, tutor.token))
        .body.data
    ).toEqual([]);
    expect((await get('/admin/library', adminToken)).body.data).toEqual([]);
    expect(
      await prisma.libraryMaterialRevision.count({ where: { materialId: id, status: 'WITHDRAWN' } })
    ).toBe(1);
  });

  it('refuses approval when the tutor’s card is no longer active', async () => {
    const created = await addFile();
    const submission = await pendingSubmission(created.body.data.id as string);
    await prisma.facultyAssignment.updateMany({
      where: { facultyId: tutor.facultyId },
      data: { isActive: false },
    });
    const res = await reviewAs(submission.id, { status: 'approved' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SUBJECT_CARD_NOT_ACTIVE');
    expect(
      (await reviewAs(submission.id, { status: 'rejected', reason: 'Card removed' })).status
    ).toBe(200);
  });

  it('guards the endpoints: authentication, CSRF and permissions', async () => {
    expect((await request(app).get(`${API}/faculty/me/library`)).status).toBe(401);
    expect((await request(app).get(`${API}/admin/library`)).status).toBe(401);
    expect((await get('/admin/library', tutor.token)).status).toBe(403);
    const created = await addFile();
    const submission = await pendingSubmission(created.body.data.id as string);
    expect((await reviewAs(submission.id, { status: 'approved' }, tutor.token)).status).toBe(403);
    const noCsrf = await request(app)
      .post(`${API}/faculty/me/library/resources`)
      .set('Authorization', `Bearer ${tutor.token}`)
      .field('curriculumId', offerings[0]!.id)
      .field('kind', 'note')
      .field('title', 'No CSRF')
      .field('body', 'x');
    expect(noCsrf.status).toBe(403);
    const student = await loginWithRole('student', 'library-student@example.com');
    expect((await get('/faculty/me/library', student.token)).status).toBe(403);
  });
});
