import { describe, it, expect } from 'vitest';
import { redact } from '@modules/audit/audit.redact.js';

describe('audit redaction', () => {
  it('hides sensitive keys at any depth and keeps the rest', () => {
    expect(
      redact({
        roles: ['admin'],
        statusCode: 200,
        method: 'POST',
        email: 'a@b.c',
        nested: { passwordHash: 'x', otp: '123456', ipAddress: '1.2.3.4', portal: 'admin' },
      })
    ).toEqual({
      roles: ['admin'],
      statusCode: 200,
      method: 'POST',
      email: '[redacted]',
      nested: {
        passwordHash: '[redacted]',
        otp: '[redacted]',
        ipAddress: '[redacted]',
        portal: 'admin',
      },
    });
  });

  it('drops the query string of a url and truncates deep nesting', () => {
    expect(redact({ url: '/api/v1/users?email=a@b.c' })).toEqual({ url: '/api/v1/users' });
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
  });
});
