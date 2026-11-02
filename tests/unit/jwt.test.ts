import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config/index.js';
import {
  JWT_ALGORITHM,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../../src/core/security/jwt.js';

const payload = {
  sub: '00000000-0000-0000-0000-000000000001',
  email: 'jwt-test@example.com',
  roles: ['viewer'],
  permissions: [],
};

function headerAlg(token: string): string {
  const header = JSON.parse(Buffer.from(token.split('.')[0] as string, 'base64url').toString());
  return header.alg as string;
}

// Builds an unsigned token ("alg": "none") with the same claims.
function unsignedToken(): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ ...payload, iat: Math.floor(Date.now() / 1000) })}.`;
}

describe('JWT algorithm pinning', () => {
  it('signs access and refresh tokens with the pinned algorithm', () => {
    expect(headerAlg(signAccessToken(payload))).toBe(JWT_ALGORITHM);
    expect(headerAlg(signRefreshToken(payload))).toBe(JWT_ALGORITHM);
  });

  it('verifies tokens it signed', () => {
    expect(verifyAccessToken(signAccessToken(payload)).sub).toBe(payload.sub);
    expect(verifyRefreshToken(signRefreshToken(payload)).sub).toBe(payload.sub);
  });

  it('rejects an access token signed with another algorithm and the same secret', () => {
    const token = jwt.sign(payload, config.jwt.secret, { algorithm: 'HS512' });
    expect(() => verifyAccessToken(token)).toThrow(/invalid algorithm/);
  });

  it('rejects a refresh token signed with another algorithm and the same secret', () => {
    const token = jwt.sign(payload, config.jwt.refreshSecret, { algorithm: 'HS384' });
    expect(() => verifyRefreshToken(token)).toThrow(/invalid algorithm/);
  });

  it('rejects an unsigned token', () => {
    expect(() => verifyAccessToken(unsignedToken())).toThrow();
    expect(() => verifyRefreshToken(unsignedToken())).toThrow();
  });
});
