/**
 * DATABASE SAFETY GUARD
 *
 * Validates that database operations during automated test suites target ONLY
 * an approved, isolated test database on an approved local or CI host.
 *
 * CRITICAL SECURITY INVARIANTS:
 * 1. Uses WHATWG URL parsing — NEVER naive string search or substring matching.
 * 2. Validates hostname, protocol, and database name independently.
 * 3. Never logs or interpolates usernames, passwords, or raw connection strings in error messages.
 * 4. Fails fast BEFORE any database connection attempt is made.
 */

export interface TestDatabaseGuardOptions {
  isCi?: boolean;
  approvedCiHosts?: string[];
  expectedDbName?: string;
}

export interface ValidatedDatabaseTarget {
  protocol: string;
  hostname: string;
  port: number;
  databaseName: string;
}

const DEFAULT_LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];
const DEFAULT_CI_HOSTS = ['localhost', '127.0.0.1', '::1', 'postgres', 'ci-postgres'];
const DEFAULT_EXPECTED_DB = 'amentorz_test';

/**
 * Parses and strictly validates a PostgreSQL connection URL for automated tests.
 * Throws a sanitized Error if validation fails.
 */
export function assertTestDatabaseUrl(
  rawUrl: string | undefined,
  options: TestDatabaseGuardOptions = {}
): ValidatedDatabaseTarget {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error(
      '[DATABASE SAFETY GUARD] Missing database connection URL. DATABASE_URL must be configured for test execution.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(
      '[DATABASE SAFETY GUARD] Malformed database connection URL. Unable to parse connection parameters.'
    );
  }

  // 1. Protocol validation
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'postgresql:' && protocol !== 'postgres:') {
    throw new Error(
      `[DATABASE SAFETY GUARD] Invalid database protocol '${protocol}'. Expected 'postgresql:' or 'postgres:'.`
    );
  }

  // 2. Extract database name from pathname (stripping leading slash and query params)
  const databaseName = parsed.pathname.replace(/^\/+/, '').split('?')[0];
  const expectedDb = options.expectedDbName || DEFAULT_EXPECTED_DB;

  // 3. Extract hostname and port safely
  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port ? parseInt(parsed.port, 10) : 5432;

  // 4. Host validation (separates local vs CI)
  const isCi =
    options.isCi ?? (process.env.CI === 'true' || process.env.CONTINUOUS_INTEGRATION === 'true');
  const envCiHosts = process.env.APPROVED_TEST_DB_HOSTS
    ? process.env.APPROVED_TEST_DB_HOSTS.split(',').map((h) => h.trim().toLowerCase())
    : [];

  const allowedHosts = isCi
    ? Array.from(new Set([...DEFAULT_CI_HOSTS, ...envCiHosts, ...(options.approvedCiHosts || [])]))
    : DEFAULT_LOCAL_HOSTS;

  if (!allowedHosts.includes(hostname)) {
    throw new Error(
      `[DATABASE SAFETY GUARD] Refusing to run tests: Target host '${hostname}:${port}' is not an authorized test database host. Expected an approved ${
        isCi
          ? 'CI host (e.g. localhost, postgres)'
          : 'local loopback interface (localhost, 127.0.0.1)'
      }.`
    );
  }

  // 5. Database name validation (exact match)
  if (databaseName !== expectedDb) {
    throw new Error(
      `[DATABASE SAFETY GUARD] Refusing to run tests: Database '${databaseName}' on host '${hostname}:${port}' is not an authorized test database. Expected exact database name '${expectedDb}'.`
    );
  }

  return {
    protocol,
    hostname,
    port,
    databaseName,
  };
}
