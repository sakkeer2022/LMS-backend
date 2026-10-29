import { describe, expect, it } from 'vitest';
import { parseDevAdminEnv } from '../../prisma/seeds/dev-admin';

const password = 'local-only-password-1';

describe('development admin seed settings', () => {
  it('requires the explicit APP_ENV=development opt-in', () => {
    expect(() => parseDevAdminEnv({ DEV_ADMIN_PASSWORD: password })).toThrow(/APP_ENV=development/);
    expect(() => parseDevAdminEnv({ APP_ENV: 'staging', DEV_ADMIN_PASSWORD: password })).toThrow(/APP_ENV=development/);
  });

  it('always refuses production, even with the opt-in', () => {
    expect(() =>
      parseDevAdminEnv({ APP_ENV: 'development', NODE_ENV: 'production', DEV_ADMIN_PASSWORD: password })
    ).toThrow(/production/);
  });

  it('has no default password', () => {
    expect(() => parseDevAdminEnv({ APP_ENV: 'development' })).toThrow();
    expect(() => parseDevAdminEnv({ APP_ENV: 'development', DEV_ADMIN_PASSWORD: '' })).toThrow();
    expect(() => parseDevAdminEnv({ APP_ENV: 'development', DEV_ADMIN_PASSWORD: 'short' })).toThrow();
  });

  it('defaults the email and lower-cases it', () => {
    expect(parseDevAdminEnv({ APP_ENV: 'development', DEV_ADMIN_PASSWORD: password, DEV_ADMIN_EMAIL: '' })).toEqual({
      email: 'admin@local.test',
      password,
      fullName: 'Local Admin',
    });
    expect(
      parseDevAdminEnv({ APP_ENV: 'development', DEV_ADMIN_PASSWORD: password, DEV_ADMIN_EMAIL: 'Me@Example.TEST' }).email
    ).toBe('me@example.test');
  });
});
