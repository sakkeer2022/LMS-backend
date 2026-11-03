import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRouteRateLimiter, rateLimitKey } from '../../src/middleware/rate-limit.js';
import { globalErrorHandler } from '../../src/middleware/errorHandler.js';

describe('rateLimitKey', () => {
  it('keys by user when authenticated, otherwise by IP', () => {
    const withUser = { user: { sub: 'u-1' }, ip: '10.0.0.1' } as never;
    const anonymous = { ip: '10.0.0.1' } as never;
    expect(rateLimitKey(withUser, 'user')).toBe('user:u-1');
    expect(rateLimitKey(anonymous, 'user')).toBe('ip:10.0.0.1');
    expect(rateLimitKey(withUser, 'ip')).toBe('ip:10.0.0.1');
  });
});

describe('createRouteRateLimiter', () => {
  function appFor(max: number) {
    const app = express();
    app.use((req, _res, next) => {
      const sub = req.header('x-user');
      if (sub) (req as unknown as { user: { sub: string } }).user = { sub };
      next();
    });
    app.post('/limited', createRouteRateLimiter({ name: `t-${Math.random()}`, windowMs: 60_000, max, keyBy: 'user', message: 'Slow down' }), (_req, res) => {
      res.status(204).end();
    });
    app.use(globalErrorHandler);
    return app;
  }

  it('returns 429 with Retry-After in the error envelope after the limit', async () => {
    const app = appFor(2);
    expect((await request(app).post('/limited').set('x-user', 'a')).status).toBe(204);
    expect((await request(app).post('/limited').set('x-user', 'a')).status).toBe(204);
    const limited = await request(app).post('/limited').set('x-user', 'a');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.body).toMatchObject({ success: false, message: 'Slow down', code: 'TOO_MANY_REQUESTS' });
  });

  it('gives each user a separate budget', async () => {
    const app = appFor(1);
    expect((await request(app).post('/limited').set('x-user', 'a')).status).toBe(204);
    expect((await request(app).post('/limited').set('x-user', 'a')).status).toBe(429);
    expect((await request(app).post('/limited').set('x-user', 'b')).status).toBe(204);
  });
});
