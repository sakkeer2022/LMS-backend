import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { config } from '../../src/config/index.js';
import { signAccessToken } from '../../src/core/security/jwt.js';
import { verifyCsrfToken } from '../../src/middleware/csrf.js';
import { globalErrorHandler } from '../../src/middleware/errorHandler.js';
import { uploadsRouter } from '../../src/modules/uploads/uploads.routes.js';
import { backgroundJobQueue } from '../../src/infrastructure/queue/index.js';
import { secureUploadPipeline } from '../../src/middleware/upload.js';
import { getCsrfToken } from '../../src/modules/auth/auth.controller.js';

vi.mock('../../src/infrastructure/queue/index.js', () => ({
  backgroundJobQueue: { add: vi.fn().mockResolvedValue({}) },
}));
// Exercise real multipart parsing, JWT permissions and CSRF without file writes,
// cloud credentials or a DB. Existing integration tests cover real quarantine.
vi.mock('../../src/middleware/upload.js', async (original) => {
  const actual = await original<typeof import('../../src/middleware/upload.js')>();
  return {
    ...actual,
    secureUploadPipeline: vi.fn((req, _res, next) => {
      req.fileQuarantine = {
        key: 'quarantine/test.png',
        storagePath: 'file://test-quarantine/test.png',
        originalName: 'test.png',
        mimetype: 'image/png',
        size: 308,
      };
      next();
    }),
  };
});

const app = express();
app.use(cookieParser(config.security.cookieSecret));
app.get('/csrf', getCsrfToken);
app.use('/uploads', verifyCsrfToken, uploadsRouter);
app.use(globalErrorHandler);

async function csrf() {
  const response = await request(app).get('/csrf');
  return {
    token: response.body.data.csrfToken as string,
    cookie: response.headers['set-cookie'][0].split(';')[0] as string,
  };
}
function token(permissions = ['uploads:create']) {
  return signAccessToken({
    sub: '8841731b-d642-42e6-b706-57b92e2acc85',
    email: 'uploader@example.org',
    roles: [],
    permissions,
  });
}

describe('Uploads route wiring (no database or real storage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backgroundJobQueue.add).mockResolvedValue(
      {} as Awaited<ReturnType<typeof backgroundJobQueue.add>>
    );
  });

  it('requires CSRF before processing uploads', async () => {
    const response = await request(app).post('/uploads').set('Cookie', `accessToken=${token()}`);
    expect(response.status).toBe(403);
    expect(secureUploadPipeline).not.toHaveBeenCalled();
  });

  it('rejects mismatched CSRF tokens', async () => {
    const data = await csrf();
    const response = await request(app)
      .post('/uploads')
      .set('Cookie', data.cookie)
      .set('x-csrf-token', 'mismatch');
    expect(response.status).toBe(403);
    expect(secureUploadPipeline).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const data = await csrf();
    const response = await request(app)
      .post('/uploads')
      .set('Cookie', data.cookie)
      .set('x-csrf-token', data.token);
    expect(response.status).toBe(401);
    expect(secureUploadPipeline).not.toHaveBeenCalled();
  });

  it('requires the existing uploads:create permission before parsing/storing', async () => {
    const data = await csrf();
    const response = await request(app)
      .post('/uploads')
      .set('Cookie', `${data.cookie}; accessToken=${token([])}`)
      .set('x-csrf-token', data.token);
    expect(response.status).toBe(403);
    expect(secureUploadPipeline).not.toHaveBeenCalled();
  });

  it('queues the quarantined file with its authenticated owner and returns 202', async () => {
    const data = await csrf();
    const response = await request(app)
      .post('/uploads')
      .set('Cookie', `${data.cookie}; accessToken=${token()}`)
      .set('x-csrf-token', data.token)
      .attach('file', Buffer.alloc(308), 'test.png');
    expect(response.status).toBe(202);
    expect(response.body.data).toEqual({ key: 'quarantine/test.png', status: 'quarantined' });
    expect(backgroundJobQueue.add).toHaveBeenCalledWith('scan-file', {
      quarantineKey: 'quarantine/test.png',
      storagePath: 'file://test-quarantine/test.png',
      originalName: 'test.png',
      mimetype: 'image/png',
      size: 308,
      userId: '8841731b-d642-42e6-b706-57b92e2acc85',
    });
    expect(response.body.data.storagePath).toBeUndefined();
  });

  it('rejects unexpected metadata before quarantine', async () => {
    const data = await csrf();
    const response = await request(app)
      .post('/uploads')
      .set('Cookie', `${data.cookie}; accessToken=${token()}`)
      .set('x-csrf-token', data.token)
      .field('ownerId', 'another-user')
      .attach('file', Buffer.alloc(308), 'test.png');
    expect(response.status).toBe(422);
    expect(secureUploadPipeline).not.toHaveBeenCalled();
    expect(backgroundJobQueue.add).not.toHaveBeenCalled();
  });

  it('does not claim acceptance if the scan job cannot be queued', async () => {
    vi.mocked(backgroundJobQueue.add).mockRejectedValueOnce(new Error('Queue unavailable'));
    const data = await csrf();
    const response = await request(app)
      .post('/uploads')
      .set('Cookie', `${data.cookie}; accessToken=${token()}`)
      .set('x-csrf-token', data.token)
      .attach('file', Buffer.alloc(308), 'test.png');
    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
  });
});
