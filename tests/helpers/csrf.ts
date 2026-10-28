import request from 'supertest';
import { app } from './app.js';

export async function getCsrfData() {
  const response = await request(app).get('/api/v1/auth/csrf-token');
  const csrfToken = response.body.data.csrfToken;
  const setCookieHeader = response.headers['set-cookie'] || [];
  const csrfCookie = Array.isArray(setCookieHeader)
    ? setCookieHeader.find(c => c.startsWith('_csrf='))
    : (setCookieHeader as string).startsWith('_csrf=') ? setCookieHeader : undefined;
  
  const cleanCookie = csrfCookie ? csrfCookie.split(';')[0] : ''; return { csrfToken, csrfCookie: cleanCookie };
}
