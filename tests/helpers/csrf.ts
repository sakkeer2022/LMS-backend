import request from 'supertest';
import { app } from './app.js';

export async function getCsrfData() {
  let response: request.Response;
  try {
    response = await request(app).get('/api/v1/auth/csrf-token');
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'unknown';
    throw new Error(
      `CSRF token request failed at ${new Date().toISOString()} (${code}): ${(err as Error).message}`
    );
  }
  const csrfToken = response.body?.data?.csrfToken;
  if (!csrfToken) {
    throw new Error(
      `CSRF token missing at ${new Date().toISOString()}: status ${response.status}, body ${String(response.text).slice(0, 200)}`
    );
  }
  const setCookieHeader = response.headers['set-cookie'] || [];
  const csrfCookie = Array.isArray(setCookieHeader)
    ? setCookieHeader.find(c => c.startsWith('_csrf='))
    : (setCookieHeader as string).startsWith('_csrf=') ? setCookieHeader : undefined;
  
  const cleanCookie = csrfCookie ? csrfCookie.split(';')[0] : ''; return { csrfToken, csrfCookie: cleanCookie };
}
