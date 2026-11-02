import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from './app.js';
import { getCsrfData } from './csrf.js';
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
// and use the generic login until it is removed.
function loginPath(roleName: string): string {
  if (roleName === 'super_admin') return '/api/v1/auth/admin/login';
  return (PORTALS as readonly string[]).includes(roleName)
    ? `/api/v1/auth/${roleName}/login`
    : '/api/v1/auth/login';
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
  const loginRes = await request(app)
    .post(loginPath(roleName))
    .set('Cookie', csrfCookie)
    .set('x-csrf-token', csrfToken)
    .send({ email, password: TEST_PASSWORD });

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
