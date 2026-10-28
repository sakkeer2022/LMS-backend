import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { prisma } from '@infrastructure/database/index.js';
import { backgroundJobQueue } from '@infrastructure/queue/index.js';
import { signAccessToken } from '@core/security/jwt.js';

describe('Upload API', () => {
  let adminToken: string;

  beforeAll(async () => {
    // Mock the queue add method
    vi.spyOn(backgroundJobQueue, 'add').mockResolvedValue({} as any);

    // Create a user with uploads:create permission
    const email = 'uploader@example.com';
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: 'hashedpassword',
        firstName: 'File',
        lastName: 'Uploader',
      },
    });

    const role = await prisma.role.create({
      data: {
        name: 'FileUploaderRole',
      },
    });

    const permission = await prisma.permission.create({
      data: {
        name: 'uploads:create',
        resource: 'uploads',
        action: 'create',
      },
    });

    await prisma.rolePermission.create({
      data: {
        roleId: role.id,
        permissionId: permission.id,
      },
    });

    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id,
      },
    });

    // Sign a token with uploads:create permission
    adminToken = signAccessToken({
      sub: user.id,
      email: user.email,
      roles: [role.name],
      permissions: ['uploads:create'],
    });
  });

  it('rejects unauthenticated requests', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const res = await request(app)
      .post('/api/v1/uploads')
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(401);
  });

  it('rejects uploads if user lacks uploads:create permission', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();

    // Create non-permission token
    const normalToken = signAccessToken({
      sub: 'some-user-id',
      email: 'user@example.com',
      roles: [],
      permissions: [],
    });

    const res = await request(app)
      .post('/api/v1/uploads')
      .set('Cookie', `accessToken=${normalToken}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(403);
  });

  it('accepts valid uploads and enqueues background scan job', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();

    // PNG Header bytes
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...Array(300).fill(0), // Pad to satisfy file-type check minimum size
    ]);

    const res = await request(app)
      .post('/api/v1/uploads')
      .set('Cookie', `accessToken=${adminToken}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .attach('file', pngBuffer, 'test.png');

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('quarantined');
    expect(res.body.data.key).toBeDefined();

    // Verify background queue job was scheduled
    expect(backgroundJobQueue.add).toHaveBeenCalledWith('scan-file', expect.any(Object));
  });

  it('rejects uploads with mismatched magic byte signatures (spoofing)', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();

    // PDF magic bytes, uploaded as PNG file to trigger signature mismatch
    const spoofedBuffer = Buffer.from([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, // %PDF-1.4
      ...Array(300).fill(0),
    ]);

    const res = await request(app)
      .post('/api/v1/uploads')
      .set('Cookie', `accessToken=${adminToken}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .attach('file', spoofedBuffer, 'shell.png');

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('File signature does not match');
  });

  it('rejects disallowed file MIME types', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();

    const htmlBuffer = Buffer.from('<html><body>Hello</body></html>');

    const res = await request(app)
      .post('/api/v1/uploads')
      .set('Cookie', `accessToken=${adminToken}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .attach('file', htmlBuffer, 'index.html');

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Disallowed MIME type');
  });
});
