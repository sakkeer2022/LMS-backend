import { describe, it, expect, vi } from 'vitest';

// Low limits for this file only (the routes read them when they are imported)
vi.mock('@config/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@config/index')>();
  return {
    ...original,
    config: {
      ...original.config,
      otp: { ...original.config.otp, resendCooldownSeconds: 1 },
      routeRateLimit: {
        ...original.config.routeRateLimit,
        otpSend: { windowMs: 60_000, maxPerIp: 1000, maxPerEmail: 2 },
        otpVerify: { windowMs: 60_000, maxPerIp: 3 },
      },
    },
  };
});

import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';

async function post(path: string, body: object) {
  const { csrfToken, csrfCookie } = await getCsrfData();
  return request(app)
    .post(path)
    .set('Cookie', csrfCookie)
    .set('x-csrf-token', csrfToken)
    .send(body);
}
const REQUESTS = '/api/v1/auth/registration/email-otp/requests';
const VERIFY = '/api/v1/auth/registration/email-otp/verify';

describe('Registration OTP rate limits', () => {
  it('limits how many codes one email can ask for, with Retry-After', async () => {
    expect((await post(REQUESTS, { email: 'limit@example.org' })).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await post(REQUESTS, { email: 'limit@example.org' })).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const res = await post(REQUESTS, { email: 'limit@example.org' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect((await post(REQUESTS, { email: 'other@example.org' })).status).toBe(202);
  });

  it('limits code checks per IP', async () => {
    const body = { challengeId: '00000000-0000-4000-8000-000000000000', otp: '123456' };
    for (let i = 0; i < 3; i++) expect((await post(VERIFY, body)).status).toBe(422);
    const res = await post(VERIFY, body);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
