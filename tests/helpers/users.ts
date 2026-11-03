import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from './app.js';
import { getCsrfData } from './csrf.js';
import { issueTokenPair } from '../../src/modules/auth/session.js';
import { PORTALS } from '@core/security/rbac.js';
import { prisma } from '@infrastructure/database/index.js';

export const TEST_PASSWORD = 'Password123!';

// Low cost factor: these are throwaway test users, and production-strength
// hashing on every fixture slows the suite and makes it timing-sensitive.
let passwordHash: Promise<string> | undefined;
function testPasswordHash(): Promise<string> {
  passwordHash ??= bcrypt.hash(TEST_PASSWORD, 4);
  return passwordHash;
}

// Portal roles sign in through their portal. Other roles (custom test roles) have no portal
// and get a session minted directly (see signIn).
function loginPath(roleName: string): string | null {
  if (roleName === 'super_admin') return '/api/v1/auth/admin/login';
  return (PORTALS as readonly string[]).includes(roleName)
    ? `/api/v1/auth/${roleName}/login`
    : null;
}

/**
 * Signs in an existing user without a portal: checks the password, then mints a session the way
 * the login does. For tests whose users hold custom roles or are created through the legacy
 * register route. Returns the parts of a login response that tests read.
 */
export async function signIn(credentials: {
  email: string;
  password: string;
}): Promise<{ status: number; headers: { 'set-cookie': string[] } }> {
  const user = await prisma.user.findFirstOrThrow({ where: { email: credentials.email } });
  if (!(await bcrypt.compare(credentials.password, user.passwordHash))) {
    throw new Error(`signIn: wrong password for ${credentials.email}`);
  }
  const tokens = await issueTokenPair(user, { ipAddress: '127.0.0.1', userAgent: 'vitest' });
  return {
    status: 200,
    headers: {
      'set-cookie': [
        `accessToken=${tokens.accessToken}; Path=/; HttpOnly`,
        `refreshToken=${tokens.refreshToken}; Path=/api/v1/auth; HttpOnly`,
      ],
    },
  };
}

export interface LoggedInUser {
  userId: string;
  /** Access token value */
  token: string;
  /** `name=value` cookie pairs, ready for a Cookie header */
  accessCookie: string;
  refreshCookie: string;
  csrfToken: string;
  csrfCookie: string;
}

/**
 * Creates a user directly in the database (not through another module's API),
 * gives them an existing role and logs in through the real login endpoint.
 * Returns the user id and an access token carrying the role's permissions.
 */
export async function loginWithRole(roleName: string, email: string): Promise<LoggedInUser> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await testPasswordHash(),
      fullName: `${roleName} user`,
      emailVerifiedAt: new Date(),
      roles: { create: { roleId: role.id } },
    },
  });

  const { csrfToken, csrfCookie } = await getCsrfData();
  const path = loginPath(roleName);
  const loginRes = path
    ? await request(app)
        .post(path)
        .set('Cookie', csrfCookie)
        .set('x-csrf-token', csrfToken)
        .send({ email, password: TEST_PASSWORD })
    : await signIn({ email, password: TEST_PASSWORD });

  const setCookies = (loginRes.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const pair = (name: string): string | undefined =>
    setCookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0];
  const accessCookie = pair('accessToken');
  const refreshCookie = pair('refreshToken');
  if (!accessCookie || !refreshCookie) {
    throw new Error(`Login failed for ${email} (status ${loginRes.status})`);
  }
  return {
    userId: user.id,
    token: accessCookie.split('=')[1]!,
    accessCookie,
    refreshCookie,
    csrfToken,
    csrfCookie,
  };
}

/** Confirms the password for a logged-in user so reauthentication-gated routes accept the session. */
export async function reauthenticate(user: LoggedInUser): Promise<void> {
  const res = await request(app)
    .post('/api/v1/auth/reauthenticate')
    .set('Authorization', `Bearer ${user.token}`)
    .set('Cookie', user.csrfCookie)
    .set('x-csrf-token', user.csrfToken)
    .send({ password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`Reauthentication failed (status ${res.status})`);
}
