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
  jti?: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

// ── Sign ────────────────────────────────────────────────────────
export function signAccessToken(
  payload: Omit<TokenPayload, 'iat' | 'exp'> & { jti?: string }
): string {
  const finalPayload = { jti: crypto.randomUUID(), ...payload };
  return jwt.sign(finalPayload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as ms.StringValue,
  });
}

export function signRefreshToken(
  payload: Omit<TokenPayload, 'iat' | 'exp'> & { jti?: string }
): string {
  const finalPayload = { jti: crypto.randomUUID(), ...payload };
  return jwt.sign(finalPayload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn as ms.StringValue,
  });
}

// ── Verify ───────────────────────────────────────────────────────
export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwt.secret) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwt.refreshSecret) as TokenPayload;
}

// ── Helpers ──────────────────────────────────────────────────────
export function getAccessTokenTtlSeconds(): number {
  return Math.floor(ms(config.jwt.expiresIn as ms.StringValue) / 1000);
}

export function getRefreshTokenExpiryDate(): Date {
  const ttlMs = ms(config.jwt.refreshExpiresIn as ms.StringValue);
  return new Date(Date.now() + ttlMs);
}
