import { describe, it, expect } from 'vitest';
import { contractResponseErrors } from '../helpers/contract.js';

describe('contractResponseErrors', () => {
  const validCsrf = {
    success: true,
    message: 'CSRF token generated',
    data: { csrfToken: 'a'.repeat(64) },
  };

  it('accepts a body that matches the operation schema', () => {
    expect(contractResponseErrors('get', '/api/v1/auth/csrf-token', 200, validCsrf)).toEqual([]);
  });

  it('reports a missing required property', () => {
    const errors = contractResponseErrors('get', '/api/v1/auth/csrf-token', 200, {
      success: true,
      message: 'x',
    });
    expect(errors.join(' ')).toContain("must have required property 'data'");
  });

  it('validates shared error responses', () => {
    const errors = contractResponseErrors('get', '/api/v1/auth/me', 401, { unexpected: true });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('matches templated paths', () => {
    const errors = contractResponseErrors(
      'delete',
      '/api/v1/auth/sessions/0f4d3c1e-5b6a-4c2d-8e9f-001122334455',
      200,
      {}
    );
    expect(errors.join(' ')).not.toContain('is not in the contract');
  });

  it('explains when there is nothing to validate against', () => {
    expect(contractResponseErrors('get', '/api/v1/nowhere', 200, {})).toEqual([
      '/api/v1/nowhere is not in the contract',
    ]);
    expect(contractResponseErrors('get', '/api/v1/auth/csrf-token', 418, {})).toEqual([
      'GET /auth/csrf-token documents no 418 response',
    ]);
  });
});
