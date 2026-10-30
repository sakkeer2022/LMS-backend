import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { Application } from 'express';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config/index.js';

describe('CORS allowlist', () => {
  let app: Application;
  const allowedOrigin = config.security.allowedOrigins[0] as string;

  beforeAll(() => {
    app = createApp();
  });

  it('has at least one allowed origin configured', () => {
    expect(allowedOrigin).toBeDefined();
  });

  it('allows credentialed requests from an allowed origin', async () => {
    const res = await request(app).get('/health').set('Origin', allowedOrigin);

    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('answers preflight requests from an allowed origin', async () => {
    const res = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', allowedOrigin)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
  });

  it('does not allow an unknown origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example.com');

    // Without Access-Control-Allow-Origin the browser blocks the response; the cors
    // package still sends Allow-Credentials, which has no effect on its own.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never answers with a wildcard origin', async () => {
    const res = await request(app).get('/health').set('Origin', allowedOrigin);

    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});
