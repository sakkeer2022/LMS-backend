import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { Application } from 'express';

describe('Helmet Security Headers', () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
  });

  it('contains HSTS header with max-age=63072000, includeSubDomains, preload', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['strict-transport-security']).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
  });

  it('contains Referrer-Policy header with no-referrer-when-downgrade', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['referrer-policy']).toBe('no-referrer-when-downgrade');
  });

  it('contains Content-Security-Policy header with strict settings', async () => {
    const res = await request(app).get('/health');

    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
  });
});
