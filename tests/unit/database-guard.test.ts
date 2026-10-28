import { describe, it, expect } from 'vitest';
import { assertTestDatabaseUrl } from '../../src/infrastructure/database/safety-guard.js';

describe('Database Safety Guard Unit Tests (In-Memory, No DB)', () => {
  it('Case 1: rejects when password contains _test on non-test DB without exposing password', () => {
    const sensitivePassword = 'super_secret_test_password_xyz!';
    const rawUrl = `postgresql://app_user:${sensitivePassword}@production.internal.net:5432/amentorz_production`;

    expect(() => {
      assertTestDatabaseUrl(rawUrl, { isCi: false });
    }).toThrowError(/Refusing to run tests: Target host 'production.internal.net:5432' is not an authorized test database host/);

    try {
      assertTestDatabaseUrl(rawUrl, { isCi: false });
    } catch (err: unknown) {
      const errorMsg = (err as Error).message;
      expect(errorMsg).not.toContain(sensitivePassword);
      expect(errorMsg).not.toContain('app_user');
      expect(errorMsg).not.toContain('postgresql://');
    }
  });

  it('Case 2: rejects when hostname contains _test on non-test DB', () => {
    const rawUrl = 'postgresql://user:pass@db_test.aws.amentorz.internal:5432/amentorz_prod';

    expect(() => {
      assertTestDatabaseUrl(rawUrl, { isCi: false });
    }).toThrowError(/Target host 'db_test.aws.amentorz.internal:5432' is not an authorized test database host/);
  });

  it('Case 3: rejects when query parameters contain _test on a dev database', () => {
    const rawUrl = 'postgresql://postgres:pass@localhost:5432/amentorz_dev?schema=public&flag=_test';

    expect(() => {
      assertTestDatabaseUrl(rawUrl, { isCi: false });
    }).toThrowError(/Database 'amentorz_dev' on host 'localhost:5432' is not an authorized test database. Expected exact database name 'amentorz_test'./);
  });

  it('Case 4: rejects development database name on localhost', () => {
    const rawUrl = 'postgresql://postgres:pass@127.0.0.1:5432/amentorz_dev';

    expect(() => {
      assertTestDatabaseUrl(rawUrl, { isCi: false });
    }).toThrowError(/Database 'amentorz_dev' on host '127.0.0.1:5432' is not an authorized test database/);
  });

  it('Case 5: rejects incorrect/system database name on localhost', () => {
    const rawUrl = 'postgresql://postgres:pass@localhost:5432/postgres';

    expect(() => {
      assertTestDatabaseUrl(rawUrl, { isCi: false });
    }).toThrowError(/Database 'postgres' on host 'localhost:5432' is not an authorized test database/);
  });

  it('Case 6: rejects unauthorized remote host even if database is named amentorz_test', () => {
    const rawUrl = 'postgresql://postgres:pass@192.168.1.100:5432/amentorz_test';

    expect(() => {
      assertTestDatabaseUrl(rawUrl, { isCi: false });
    }).toThrowError(/Target host '192.168.1.100:5432' is not an authorized test database host/);
  });

  it('Case 7: rejects missing or malformed connection strings', () => {
    expect(() => assertTestDatabaseUrl('')).toThrowError(/Missing database connection URL/);
    expect(() => assertTestDatabaseUrl(undefined)).toThrowError(/Missing database connection URL/);
    expect(() => assertTestDatabaseUrl('not-a-valid-url')).toThrowError(/Malformed database connection URL/);
    expect(() => assertTestDatabaseUrl('http://localhost:5432/amentorz_test')).toThrowError(/Invalid database protocol 'http:'/);
  });

  it('Case 8: authorizes valid test database on localhost', () => {
    const validUrl = 'postgresql://postgres:password@localhost:5432/amentorz_test?schema=public';
    const result = assertTestDatabaseUrl(validUrl, { isCi: false });

    expect(result.protocol).toBe('postgresql:');
    expect(result.hostname).toBe('localhost');
    expect(result.port).toBe(5432);
    expect(result.databaseName).toBe('amentorz_test');
  });

  it('Case 9: authorizes approved CI service hostname when CI is enabled', () => {
    const ciUrl = 'postgresql://ci_user:ci_pass@postgres:5432/amentorz_test?schema=public';
    const result = assertTestDatabaseUrl(ciUrl, { isCi: true });

    expect(result.hostname).toBe('postgres');
    expect(result.databaseName).toBe('amentorz_test');
  });

  it('Case 10: rejects unapproved CI host when CI is enabled', () => {
    const remoteCiUrl = 'postgresql://ci_user:ci_pass@external-rds.amazonaws.com:5432/amentorz_test';

    expect(() => {
      assertTestDatabaseUrl(remoteCiUrl, { isCi: true });
    }).toThrowError(/Target host 'external-rds.amazonaws.com:5432' is not an authorized test database host/);
  });
});
