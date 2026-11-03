import { describe, it, expect, vi } from 'vitest';

// A low signing limit for this file only (the routes read it when they are imported)
vi.mock('@config/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@config/index')>();
  return {
    ...original,
    config: {
      ...original.config,
      routeRateLimit: {
        ...original.config.routeRateLimit,
        consentSign: { windowMs: 60_000, maxPerIp: 2 },
      },
    },
  };
});

import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';

describe('Consent signing rate limit', () => {
  it('returns 429 with Retry-After after too many signing requests from one IP', async () => {
    const attempt = async (): Promise<request.Response> => {
      const { csrfToken, csrfCookie } = await getCsrfData();
      return request(app)
        .post('/api/v1/consent/guardian-signatures')
        .set('Cookie', csrfCookie)
        .set('x-csrf-token', csrfToken)
        .field('policyId', '00000000-0000-4000-8000-000000000000');
    };
    expect((await attempt()).status).toBe(422);
    expect((await attempt()).status).toBe(422);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});
