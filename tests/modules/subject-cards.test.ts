import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { loginWithRole } from '../helpers/users.js';
import { expectContractResponse } from '../helpers/contract.js';
import {
  createOfferings,
  priceTutorCard,
  signedInTutor,
  type Tutor,
} from '../helpers/subject-cards.js';
import { prisma } from '@infrastructure/database/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';
import { InMemoryEmailProvider, setEmailProvider } from '../../src/infrastructure/email/index.js';

const API = '/api/v1';
type Csrf = { csrfToken: string; csrfCookie: string };

describe('Subject cards after onboarding (limit 5, request, admin review)', () => {
  let csrf: Csrf;
  let mail: InMemoryEmailProvider;
  let adminToken: string;
  let offerings: { id: string }[];

  beforeEach(async () => {
    await seedRbac(prisma);
    csrf = await getCsrfData();
    mail = new InMemoryEmailProvider();
    setEmailProvider(mail);
    offerings = await createOfferings(7);
    ({ token: adminToken } = await loginWithRole('admin', 'cards-admin@example.com'));
  });

  const send = (method: 'post' | 'put' | 'delete', path: string, token: string, body?: unknown) =>
    request(app)
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', csrf.csrfCookie)
      .set('x-csrf-token', csrf.csrfToken)
      .send(body as object);
  const get = (path: string, token: string) =>
    request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`);
  const requestCard = (tutor: Tutor, curriculumId: string) =>
    send('post', '/faculty/me/subject-cards', tutor.token, { curriculumId });
  const review = (tutor: Tutor, cardId: string, body: unknown) =>
    send(
      'put',
      `/admin/faculty/${tutor.facultyId}/subject-cards/${cardId}/review`,
      adminToken,
      body
    );
  const ids = (n: number, from = 0) => offerings.slice(from, from + n).map((o) => o.id);

  it('lists the tutor’s cards with the limit and library eligibility', async () => {
    const tutor = await signedInTutor('cards-list@example.com', ids(2));
    const res = await get('/faculty/me/subject-cards', tutor.token);
    expect(res.status).toBe(200);
    expectContractResponse(res, 'get', '/faculty/me/subject-cards');
    expect(res.body.data).toMatchObject({ limit: 5, used: 2, remaining: 3, canRequest: true });
    expect(res.body.data.cards).toHaveLength(2);
    expect(res.body.data.cards[0]).toMatchObject({
      status: 'approved',
      source: 'onboarding',
      priced: true,
      libraryEnabled: true,
    });
  });

  it('adds a pending card that does not lock the tutor out, and lists it for pricing', async () => {
    const tutor = await signedInTutor('cards-request@example.com', ids(2));
    const res = await requestCard(tutor, offerings[2]!.id);
    expect(res.status).toBe(201);
    expectContractResponse(res, 'post', '/faculty/me/subject-cards');
    const added = res.body.data.cards.find(
      (c: { curriculumId: string }) => c.curriculumId === offerings[2]!.id
    );
    expect(added).toMatchObject({
      status: 'pending',
      source: 'profile',
      priced: false,
      libraryEnabled: false,
    });
    expect(res.body.data.used).toBe(3);

    // The pending card is not part of the prices the tutor accepts
    const consent = await get('/faculty/me/price-consent', tutor.token);
    expect(consent.status).toBe(200);
    expect(consent.body.data.subjects).toHaveLength(2);

    const awaiting = await get('/admin/prices/awaiting', adminToken);
    expectContractResponse(awaiting, 'get', '/admin/prices/awaiting');
    expect(awaiting.body.data).toEqual([
      expect.objectContaining({
        facultyId: tutor.facultyId,
        cardId: added.id,
        cardStatus: 'pending',
      }),
    ]);
    expect(
      await prisma.auditLog.count({ where: { action: 'faculty.subject_card_requested' } })
    ).toBe(1);
  });

  it('refuses a sixth card, a duplicate, and concurrent requests past the limit', async () => {
    const full = await signedInTutor('cards-full@example.com', ids(5));
    const sixth = await requestCard(full, offerings[5]!.id);
    expect(sixth.status).toBe(409);
    expect(sixth.body.code).toBe('SUBJECT_CARD_LIMIT');
    expect((await get('/faculty/me/subject-cards', full.token)).body.data.canRequest).toBe(false);

    const tutor = await signedInTutor('cards-race@example.com', ids(4));
    const duplicate = await requestCard(tutor, offerings[0]!.id);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('SUBJECT_CARD_EXISTS');

    // Two requests at once for the last slot: exactly one wins
    const results = await Promise.all([
      requestCard(tutor, offerings[4]!.id),
      requestCard(tutor, offerings[5]!.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.facultyAssignment.count({ where: { facultyId: tutor.facultyId } })).toBe(5);
  });

  it('enforces the limit in the database for every write path', async () => {
    const tutor = await signedInTutor('cards-trigger@example.com', ids(5));
    await expect(
      prisma.facultyAssignment.create({
        data: { facultyId: tutor.facultyId, curriculumId: offerings[5]!.id },
      })
    ).rejects.toThrow(/subject_cards:LIMIT_REACHED/);
    // A rejected card holds no slot, and re-activating it is checked again
    await prisma.facultyAssignment.create({
      data: { facultyId: tutor.facultyId, curriculumId: offerings[5]!.id, status: 'REJECTED' },
    });
    await expect(
      prisma.facultyAssignment.updateMany({
        where: { facultyId: tutor.facultyId, curriculumId: offerings[5]!.id },
        data: { status: 'PENDING' },
      })
    ).rejects.toThrow(/subject_cards:LIMIT_REACHED/);
  });

  it('refuses requests before the application is approved', async () => {
    const tutor = await signedInTutor('cards-pending@example.com', ids(1), {
      approvalStatus: 'PENDING',
    });
    const res = await requestCard(tutor, offerings[1]!.id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FACULTY_NOT_APPROVED');
  });

  it('refuses an offering that is not selectable', async () => {
    const tutor = await signedInTutor('cards-closed@example.com', ids(1));
    await prisma.curriculum.update({ where: { id: offerings[6]!.id }, data: { isActive: false } });
    const res = await requestCard(tutor, offerings[6]!.id);
    expect(res.status).toBe(422);
  });

  it('cancels only pending requests', async () => {
    const tutor = await signedInTutor('cards-cancel@example.com', ids(1));
    const added = await requestCard(tutor, offerings[1]!.id);
    const pending = added.body.data.cards.find((c: { status: string }) => c.status === 'pending');
    const approved = added.body.data.cards.find((c: { status: string }) => c.status === 'approved');

    const refused = await send('delete', `/faculty/me/subject-cards/${approved.id}`, tutor.token);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('SUBJECT_CARD_NOT_PENDING');

    const other = await signedInTutor('cards-other@example.com', ids(1, 2));
    expect(
      (await send('delete', `/faculty/me/subject-cards/${pending.id}`, other.token)).status
    ).toBe(404);

    const cancelled = await send('delete', `/faculty/me/subject-cards/${pending.id}`, tutor.token);
    expect(cancelled.status).toBe(200);
    expectContractResponse(cancelled, 'delete', '/faculty/me/subject-cards/{cardId}');
    expect(cancelled.body.data.cards).toHaveLength(1);
  });

  it('approves a priced card: the tutor accepts the new price, then the card opens in the library', async () => {
    const tutor = await signedInTutor('cards-approve@example.com', ids(1));
    const added = await requestCard(tutor, offerings[1]!.id);
    const card = added.body.data.cards.find((c: { status: string }) => c.status === 'pending');

    const unpriced = await review(tutor, card.id, { decision: 'approve' });
    expect(unpriced.status).toBe(409);
    expect(unpriced.body.code).toBe('SUBJECT_CARD_NOT_PRICED');

    await priceTutorCard(tutor.facultyId, offerings[1]!.id, 150000);
    const prices = await get(`/admin/prices?facultyId=${tutor.facultyId}`, adminToken);
    expectContractResponse(prices, 'get', '/admin/prices');
    expect(
      prices.body.data.find((r: { curriculumId: string }) => r.curriculumId === offerings[1]!.id)
    ).toMatchObject({
      cardId: card.id,
      cardStatus: 'pending',
    });

    const approved = await review(tutor, card.id, { decision: 'approve' });
    expect(approved.status).toBe(200);
    expectContractResponse(
      approved,
      'put',
      '/admin/faculty/{facultyId}/subject-cards/{cardId}/review'
    );
    expect(approved.body.data.status).toBe('approved');
    expect(mail.sent.some((m) => m.category === 'faculty-subject-card-approved')).toBe(true);

    const again = await review(tutor, card.id, { decision: 'reject', reason: 'Late' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('SUBJECT_CARD_ALREADY_DECIDED');

    const consent = await get('/faculty/me/price-consent', tutor.token);
    expect(consent.body.data.subjects).toHaveLength(2);
    expect(consent.body.data.status).toBe('required');
    const cards = await get('/faculty/me/subject-cards', tutor.token);
    expect(cards.body.data.cards.every((c: { libraryEnabled: boolean }) => c.libraryEnabled)).toBe(
      true
    );
  });

  it('rejects with a reason, which frees the slot and lets the tutor ask again', async () => {
    const tutor = await signedInTutor('cards-reject@example.com', ids(4));
    const added = await requestCard(tutor, offerings[4]!.id);
    const card = added.body.data.cards.find((c: { status: string }) => c.status === 'pending');

    const noReason = await review(tutor, card.id, { decision: 'reject' });
    expect(noReason.status).toBe(422);

    const rejected = await review(tutor, card.id, {
      decision: 'reject',
      reason: 'Not offered in your city',
    });
    expect(rejected.status).toBe(200);
    expect(mail.sent.some((m) => m.category === 'faculty-subject-card-rejected')).toBe(true);

    const mine = await get('/faculty/me/subject-cards', tutor.token);
    expect(mine.body.data).toMatchObject({ used: 4, remaining: 1, canRequest: true });
    expect(mine.body.data.cards.find((c: { id: string }) => c.id === card.id)).toMatchObject({
      status: 'rejected',
      decisionReason: 'Not offered in your city',
    });
    const awaiting = await get('/admin/prices/awaiting', adminToken);
    expect(awaiting.body.data).toEqual([]);

    const askedAgain = await requestCard(tutor, offerings[4]!.id);
    expect(askedAgain.status).toBe(201);
    expect(askedAgain.body.data.cards.find((c: { id: string }) => c.id === card.id).status).toBe(
      'pending'
    );
  });

  it('approves onboarding cards with the application, not later requests', async () => {
    const tutor = await signedInTutor('cards-onboarding@example.com', ids(2), {
      approvalStatus: 'PENDING',
    });
    await prisma.facultyAssignment.create({
      data: { facultyId: tutor.facultyId, curriculumId: offerings[3]!.id, source: 'PROFILE' },
    });
    const { revision } = await prisma.facultyProfile.findUniqueOrThrow({
      where: { id: tutor.facultyId },
    });
    const res = await send('put', `/admin/faculty/${tutor.facultyId}/review`, adminToken, {
      decision: 'approve',
      publish: false,
      expectedRevision: revision,
    });
    expect(res.status).toBe(200);
    expectContractResponse(res, 'put', '/admin/faculty/{facultyId}/review');
    const statuses = await prisma.facultyAssignment.findMany({
      where: { facultyId: tutor.facultyId },
      select: { source: true, status: true },
    });
    expect(
      statuses.filter((s) => s.source === 'ONBOARDING').every((s) => s.status === 'APPROVED')
    ).toBe(true);
    expect(statuses.find((s) => s.source === 'PROFILE')?.status).toBe('PENDING');
    expect(res.body.data.subjects.map((s: { status: string }) => s.status).sort()).toEqual([
      'approved',
      'approved',
      'pending',
    ]);
  });

  it('guards the endpoints: authentication, CSRF and permissions', async () => {
    const tutor = await signedInTutor('cards-guard@example.com', ids(1));
    expect((await request(app).get(`${API}/faculty/me/subject-cards`)).status).toBe(401);
    const noCsrf = await request(app)
      .post(`${API}/faculty/me/subject-cards`)
      .set('Authorization', `Bearer ${tutor.token}`)
      .send({ curriculumId: offerings[1]!.id });
    expect(noCsrf.status).toBe(403);
    const card = await prisma.facultyAssignment.findFirstOrThrow({
      where: { facultyId: tutor.facultyId },
    });
    const asTutor = await send(
      'put',
      `/admin/faculty/${tutor.facultyId}/subject-cards/${card.id}/review`,
      tutor.token,
      { decision: 'approve' }
    );
    expect(asTutor.status).toBe(403);
    const asAdmin = await get('/faculty/me/subject-cards', adminToken);
    expect(asAdmin.status).toBe(404);
  });
});
