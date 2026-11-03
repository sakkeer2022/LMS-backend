import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { Application } from 'express';

describe('API documentation routes (non-production)', () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
  });

  it('serves the implemented API spec at /api/docs/spec', async () => {
    const res = await request(app).get('/api/docs/spec');

    expect(res.status).toBe(200);
    expect(res.body.info.title).toContain('implemented');
    expect(res.body.paths).toHaveProperty('/auth/student/login');
    expect(res.body.paths).not.toHaveProperty('/faculty/me/profile');
  });

  it('serves the draft Sprint 1 contract at /api/docs/contract/spec', async () => {
    const res = await request(app).get('/api/docs/contract/spec');

    expect(res.status).toBe(200);
    expect(res.body.info.version).toContain('draft');
    expect(res.body.paths).toHaveProperty('/faculty/me/profile');
  });

  it.each(['/api/docs/', '/api/docs/contract/'])('serves Swagger UI at %s', async (url) => {
    const res = await request(app).get(url);

    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });

  // The browser UI reads its spec from swagger-ui-init.js, so each UI must embed its own
  it('embeds the matching spec in each Swagger UI', async () => {
    const implemented = await request(app).get('/api/docs/swagger-ui-init.js');
    const contract = await request(app).get('/api/docs/contract/swagger-ui-init.js');

    expect(implemented.text).toContain('(implemented)');
    expect(implemented.text).not.toContain('/faculty/me/profile');
    expect(contract.text).toContain('/faculty/me/profile');
  });
});
