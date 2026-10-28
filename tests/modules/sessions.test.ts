import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { prisma } from '@infrastructure/database/index.js';
import { verifyRefreshToken } from '@core/security/jwt.js';

describe('Active Sessions & Concurrent Session Controls API', () => {
  const userPayload = {
    email: 'session_test@example.com',
    password: 'Password123!',
    firstName: 'Session',
    lastName: 'Tester',
  };

  it('should list all active sessions, revoke a specific session, and revoke other sessions', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();

    // 1. Register user
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken)
      .send(userPayload);

    expect(registerRes.status).toBe(201);
    
    // Extract login session cookies
    const cookies = registerRes.headers['set-cookie'] as string[];
    const firstRefreshTokenCookie = cookies.find((c) => c.startsWith('refreshToken='));
    const firstRefreshToken = firstRefreshTokenCookie ? firstRefreshTokenCookie.split(';')[0].split('=')[1] : '';
    const decodedFirst = verifyRefreshToken(firstRefreshToken);
    
    const firstAccessTokenCookie = cookies.find((c) => c.startsWith('accessToken='));
    const accessToken = firstAccessTokenCookie ? firstAccessTokenCookie.split(';')[0].split('=')[1] : '';

    const authHeader = `Bearer ${accessToken}`;

    // 2. Perform a second login (simulate logging in on another device/browser)
    const secondLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken)
      .send({ email: userPayload.email, password: userPayload.password });

    expect(secondLoginRes.status).toBe(200);

    const secondCookies = secondLoginRes.headers['set-cookie'] as string[];
    const secondRefreshTokenCookie = secondCookies.find((c) => c.startsWith('refreshToken='));
    const secondRefreshToken = secondRefreshTokenCookie ? secondRefreshTokenCookie.split(';')[0].split('=')[1] : '';
    const decodedSecond = verifyRefreshToken(secondRefreshToken);

    // Verify we have 2 refresh tokens in DB
    const dbTokens = await prisma.refreshToken.findMany({
      where: { user: { email: userPayload.email } },
    });
    expect(dbTokens.length).toBe(2);

    // 3. List active sessions via GET /sessions
    const listRes = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Cookie', `${firstRefreshTokenCookie}; ${csrfCookie}`)
      .set('Authorization', authHeader);

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data).toBeInstanceOf(Array);
    expect(listRes.body.data.length).toBe(2);
    expect(listRes.body.data[0]).toHaveProperty('jti');
    expect(listRes.body.data[0]).toHaveProperty('ipAddress');
    expect(listRes.body.data[0]).toHaveProperty('userAgent');

    // Extract the other JTI (from second login) to revoke
    const otherSession = listRes.body.data.find((s: any) => s.jti === decodedSecond.jti);
    expect(otherSession).toBeDefined();

    // 4. Revoke the second session via DELETE /sessions/:jti
    const revokeRes = await request(app)
      .delete(`/api/v1/auth/sessions/${otherSession.jti}`)
      .set('Cookie', `${firstRefreshTokenCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .set('Authorization', authHeader);

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);

    // Verify only 1 active token remains in DB
    const dbTokensAfterRevoke = await prisma.refreshToken.findMany({
      where: { user: { email: userPayload.email }, used: false },
    });
    expect(dbTokensAfterRevoke.length).toBe(1);

    // 5. Create a new third session
    const thirdLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('Cookie', csrfCookie)
      .set('x-csrf-token', csrfToken)
      .send({ email: userPayload.email, password: userPayload.password });

    expect(thirdLoginRes.status).toBe(200);

    const activeTokensCount = await prisma.refreshToken.count({
      where: { user: { email: userPayload.email }, used: false },
    });
    expect(activeTokensCount).toBe(2);

    // 6. Revoke other sessions via DELETE /sessions (keeps the current session JTI)
    const revokeOthersRes = await request(app)
      .delete('/api/v1/auth/sessions')
      .set('Cookie', `${firstRefreshTokenCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .set('Authorization', authHeader);

    expect(revokeOthersRes.status).toBe(200);
    expect(revokeOthersRes.body.success).toBe(true);

    // Verify only the first session remains active
    const finalTokens = await prisma.refreshToken.findMany({
      where: { user: { email: userPayload.email }, used: false },
    });
    expect(finalTokens.length).toBe(1);
    expect(finalTokens[0].jti).toBe(decodedFirst.jti);
  });
});
