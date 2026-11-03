import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { expectContractResponse } from '../helpers/contract.js';
import { latestOtp } from '../helpers/email.js';
import { config } from '@config/index';
import { prisma } from '@infrastructure/database/index.js';
import { getTestOutbox } from '@infrastructure/email/index.js';
import { consumeRegistrationToken } from '@modules/email-otp/index.js';

const REQUESTS = '/api/v1/auth/registration/email-otp/requests';
const VERIFY = '/api/v1/auth/registration/email-otp/verify';

async function post(path: string, body: unknown) {
  const { csrfToken, csrfCookie } = await getCsrfData();
  return request(app)
    .post(path)
    .set('Cookie', csrfCookie)
    .set('x-csrf-token', csrfToken)
    .send(body as object);
}

async function ask(email: string) {
  const res = await post(REQUESTS, { email });
  expect(res.status).toBe(202);
  return res.body.data.challengeId as string;
}

// Lets the resend cooldown pass without waiting for it
async function skipCooldown(email: string) {
  await prisma.emailChallenge.updateMany({
    where: { email },
    data: { resendCooldownUntil: new Date(0) },
  });
}

describe('registration email OTP', () => {
  beforeEach(() => getTestOutbox().clear());

  it('emails a six-digit code and returns only the challenge', async () => {
    const res = await post(REQUESTS, { email: 'New.Student@Example.org ' });
    expect(res.status).toBe(202);
    expectContractResponse(res, 'post', '/auth/registration/email-otp/requests');
    const code = latestOtp('new.student@example.org');
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(res.body)).not.toContain(code);

    const row = await prisma.emailChallenge.findFirstOrThrow({
      where: { email: 'new.student@example.org' },
    });
    expect(row.userId).toBeNull();
    expect(row.otpHash).not.toContain(code);
    expect(row.attemptsRemaining).toBe(config.otp.maxAttempts);
  });

  it('answers an already registered address the same way and sends nothing', async () => {
    await prisma.user.create({
      data: { email: 'taken@example.org', passwordHash: 'x', fullName: 'Taken' },
    });
    const res = await post(REQUESTS, { email: 'taken@example.org' });
    expect(res.status).toBe(202);
    expectContractResponse(res, 'post', '/auth/registration/email-otp/requests');
    expect(getTestOutbox().to('taken@example.org')).toHaveLength(0);
    // The decoy cannot be verified with any code
    const verify = await post(VERIFY, { challengeId: res.body.data.challengeId, otp: '123456' });
    expect(verify.status).toBe(422);
  });

  it('verifies the code and issues a token whose hash is the only copy stored', async () => {
    const challengeId = await ask('verify@example.org');
    const res = await post(VERIFY, { challengeId, otp: latestOtp('verify@example.org') });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expectContractResponse(res, 'post', '/auth/registration/email-otp/verify');

    const token = res.body.data.emailVerificationToken as string;
    const row = await prisma.emailChallenge.findUniqueOrThrow({ where: { id: challengeId } });
    expect(row.consumedAt).not.toBeNull();
    expect(row.registrationTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.registrationTokenHash).not.toContain(token);
  });

  it('uses a code once', async () => {
    const challengeId = await ask('once@example.org');
    const otp = latestOtp('once@example.org');
    expect((await post(VERIFY, { challengeId, otp })).status).toBe(200);
    expect((await post(VERIFY, { challengeId, otp })).status).toBe(422);
  });

  it('lets only one of two simultaneous verifications succeed', async () => {
    const challengeId = await ask('race@example.org');
    const otp = latestOtp('race@example.org');
    const results = await Promise.all([
      post(VERIFY, { challengeId, otp }),
      post(VERIFY, { challengeId, otp }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
  });

  it('rejects a wrong code, counts the attempt and stops with 429 when attempts run out', async () => {
    const challengeId = await ask('attempts@example.org');
    const right = latestOtp('attempts@example.org');
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < config.otp.maxAttempts; i += 1) {
      expect((await post(VERIFY, { challengeId, otp: wrong })).status).toBe(422);
    }
    const locked = await post(VERIFY, { challengeId, otp: right });
    expect(locked.status).toBe(429);
  });

  it('asking again inside the cooldown returns 429', async () => {
    await ask('cooldown@example.org');
    const again = await post(REQUESTS, { email: 'cooldown@example.org' });
    expect(again.status).toBe(429);
  });

  it('a new request invalidates the previous code', async () => {
    const first = await ask('resend@example.org');
    const firstCode = latestOtp('resend@example.org');
    await skipCooldown('resend@example.org');
    const second = await ask('resend@example.org');
    expect(second).not.toBe(first);
    const secondCode = latestOtp('resend@example.org');
    expect((await post(VERIFY, { challengeId: first, otp: firstCode })).status).toBe(422);
    expect((await post(VERIFY, { challengeId: second, otp: secondCode })).status).toBe(200);
  });

  it('rejects an expired challenge', async () => {
    const challengeId = await ask('expired@example.org');
    const otp = latestOtp('expired@example.org');
    await prisma.emailChallenge.update({
      where: { id: challengeId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await post(VERIFY, { challengeId, otp })).status).toBe(422);
  });

  it('validates the bodies', async () => {
    expect((await post(REQUESTS, { email: 'not-an-email' })).status).toBe(422);
    expect((await post(REQUESTS, { email: 'a@example.org', role: 'admin' })).status).toBe(422);
    expect((await post(VERIFY, { challengeId: 'nope', otp: '123456' })).status).toBe(422);
    const challengeId = await ask('format@example.org');
    expect((await post(VERIFY, { challengeId, otp: '12345' })).status).toBe(422);
    expect((await post(VERIFY, { challengeId, otp: '123456', extra: 1 })).status).toBe(422);
  });

  it('requires a CSRF token', async () => {
    const res = await request(app).post(REQUESTS).send({ email: 'csrf@example.org' });
    expect(res.status).toBe(403);
  });
});

describe('registration email token', () => {
  beforeEach(() => getTestOutbox().clear());

  async function verifiedToken(email: string) {
    const challengeId = await ask(email);
    const res = await post(VERIFY, { challengeId, otp: latestOtp(email) });
    return res.body.data.emailVerificationToken as string;
  }

  it('is consumed once and returns the verified email', async () => {
    const token = await verifiedToken('token@example.org');
    await expect(consumeRegistrationToken(token)).resolves.toBe('token@example.org');
    await expect(consumeRegistrationToken(token)).rejects.toThrow();
  });

  it('is rejected when unknown or expired', async () => {
    await expect(consumeRegistrationToken('not-a-token')).rejects.toThrow();
    const token = await verifiedToken('late@example.org');
    await prisma.emailChallenge.updateMany({
      where: { email: 'late@example.org' },
      data: { registrationTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    await expect(consumeRegistrationToken(token)).rejects.toThrow();
  });
});
