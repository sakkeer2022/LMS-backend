import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every role confirms a password change by email in this file
vi.mock('@config/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@config/index')>();
  return {
    ...original,
    config: { ...original.config, otp: { ...original.config.otp, passwordChangeOtpRoles: 'all' } },
  };
});

import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { latestOtp } from '../helpers/email.js';
import { TEST_PASSWORD, loginWithRole } from '../helpers/users.js';
import { prisma } from '@infrastructure/database/index.js';
import { getTestOutbox } from '@infrastructure/email/index.js';
import { seedRbac } from '../../prisma/seed-rbac.js';

describe('PASSWORD_CHANGE_OTP_ROLES=all', () => {
  beforeEach(async () => {
    await seedRbac(prisma);
    getTestOutbox().clear();
  });

  it('asks a student for the email code too', async () => {
    const student = await loginWithRole('student', 'learner@example.org');
    const { csrfToken, csrfCookie } = await getCsrfData();
    const send = (method: 'put' | 'post', path: string, body?: object) =>
      request(app)
        [method](`/api/v1/auth${path}`)
        .set('Authorization', `Bearer ${student.token}`)
        .set('Cookie', csrfCookie)
        .set('x-csrf-token', csrfToken)
        .send(body);

    const base = { currentPassword: TEST_PASSWORD, newPassword: 'Brand-new-pass1' };
    expect((await send('put', '/password', base)).status).toBe(422);
    const asked = await send('post', '/password/requests');
    expect(asked.status).toBe(202);
    const changed = await send('put', '/password', {
      ...base,
      challengeId: asked.body.data.challengeId,
      otp: latestOtp('learner@example.org'),
    });
    expect(changed.status).toBe(200);
  });
});
