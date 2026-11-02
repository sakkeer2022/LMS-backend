import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import ms from 'ms';
import { config } from '@config/index';
import type { PolicyRule } from './policy.js';

export interface TokenPayload {
  sub: string; // user id
  email: string;
  roles: string[];
  permissions: string[];
  policies?: PolicyRule[];
  sid?: string; // session family id, stable across refresh rotation
  portal?: string; // 'student' | 'faculty' | 'admin' for portal sessions
  rm?: true; // signed in with "keep me signed in"; decides the cookie and session lifetime
  jti?: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

// Pinned so a token signed with any other algorithm (including "none") is rejected.
export const JWT_ALGORITHM = 'HS256' as const;

// ── Sign ────────────────────────────────────────────────────────
export function signAccessToken(
  payload: Omit<TokenPayload, 'iat' | 'exp'> & { jti?: string }
): string {
  const finalPayload = { jti: crypto.randomUUID(), ...payload };
  return jwt.sign(finalPayload, config.jwt.secret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: config.jwt.expiresIn as ms.StringValue,
  });
}

export function signRefreshToken(
  payload: Omit<TokenPayload, 'iat' | 'exp'> & { jti?: string }
): string {
  const finalPayload = { jti: crypto.randomUUID(), ...payload };
  return jwt.sign(finalPayload, config.jwt.refreshSecret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: config.jwt.refreshExpiresIn as ms.StringValue,
  });
}

// ── Verify ───────────────────────────────────────────────────────
export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwt.secret, { algorithms: [JWT_ALGORITHM] }) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwt.refreshSecret, {
    algorithms: [JWT_ALGORITHM],
  }) as TokenPayload;
}

// ── Helpers ──────────────────────────────────────────────────────
export function getAccessTokenTtlSeconds(): number {
  return Math.floor(ms(config.jwt.expiresIn as ms.StringValue) / 1000);
}

export function getRefreshTokenExpiryDate(remember = true): Date {
  const ttlMs = ms(
    (remember ? config.jwt.refreshExpiresIn : config.jwt.sessionExpiresIn) as ms.StringValue
  );
  return new Date(Date.now() + ttlMs);
}
