import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { routeRateLimit } from '@middleware/rate-limit';
import { globalErrorHandler } from '@middleware/errorHandler';

function appWith(options: Parameters<typeof routeRateLimit>[0]): express.Express {
  const app = express();
  app.use(express.json());
  app.post('/limited', ...routeRateLimit(options), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(globalErrorHandler);
  return app;
}

describe('routeRateLimit', () => {
  it('returns 429 with Retry-After once the IP limit is used up', async () => {
    const app = appWith({ name: 'ip-test', ip: { windowMs: 60_000, max: 2 } });
    expect((await request(app).post('/limited').send({})).status).toBe(200);
    expect((await request(app).post('/limited').send({})).status).toBe(200);

    const res = await request(app).post('/limited').send({});
    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('limits per email, ignoring case and spaces, and not other emails', async () => {
    const app = appWith({
      name: 'email-test',
      ip: { windowMs: 60_000, max: 100 },
      email: { windowMs: 60_000, max: 2 },
    });
    await request(app).post('/limited').send({ email: 'A@Example.com' });
    await request(app).post('/limited').send({ email: ' a@example.com ' });

    expect((await request(app).post('/limited').send({ email: 'a@example.com' })).status).toBe(429);
    expect((await request(app).post('/limited').send({ email: 'b@example.com' })).status).toBe(200);
  });

  it('falls back to the IP when the body has no email', async () => {
    const app = appWith({
      name: 'no-email-test',
      ip: { windowMs: 60_000, max: 100 },
      email: { windowMs: 60_000, max: 1 },
    });
    expect((await request(app).post('/limited').send({})).status).toBe(200);
    expect((await request(app).post('/limited').send({})).status).toBe(429);
  });

  it('keeps separate counters for separate route names', async () => {
    const a = appWith({ name: 'route-a', ip: { windowMs: 60_000, max: 1 } });
    const b = appWith({ name: 'route-b', ip: { windowMs: 60_000, max: 1 } });
    await request(a).post('/limited').send({});
    expect((await request(a).post('/limited').send({})).status).toBe(429);
    expect((await request(b).post('/limited').send({})).status).toBe(200);
  });
});
