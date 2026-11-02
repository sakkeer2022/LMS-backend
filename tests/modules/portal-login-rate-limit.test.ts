import { describe, it, expect, vi, beforeEach } from 'vitest';

// Low login limits for this file only. The mock applies to modules loaded after it, which
// includes the app's routes (they read the limits when they are imported).
vi.mock('@config/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@config/index')>();
  return {
    ...original,
    config: {
      ...original.config,
      routeRateLimit: {
        ...original.config.routeRateLimit,
        login: { windowMs: 60_000, maxPerIp: 1000, maxPerEmail: 3 },
      },
    },
  };
});

import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';

async function attempt(email: string) {
  const { csrfToken, csrfCookie } = await getCsrfData();
  return request(app)
    .post('/api/v1/auth/admin/login')
    .set('Cookie', csrfCookie)
    .set('x-csrf-token', csrfToken)
    .send({ email, password: 'Wrong-pass1' });
}

describe('Portal login rate limit', () => {
  beforeEach(() => undefined);

  it('returns 429 with Retry-After after too many attempts for one email, on any portal', async () => {
    for (let i = 0; i < 3; i++) expect((await attempt('limited@example.com')).status).toBe(401);

    const res = await attempt('limited@example.com');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('does not limit a different email', async () => {
    expect((await attempt('someone-else@example.com')).status).toBe(401);
  });
});
