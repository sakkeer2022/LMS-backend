import { randomUUID } from 'crypto';
import { prisma } from '@infrastructure/database/index';
import { signAccessToken } from '@core/security/jwt';

/**
 * Creates an active user and signs an access token carrying exactly the given
 * permissions, without going through the auth module's HTTP endpoints.
 */
export async function createUserWithPermissions(
  permissions: string[],
  roles: string[] = ['admin']
): Promise<{ userId: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      email: `user-${randomUUID()}@test.com`,
      passwordHash: 'not-used-in-these-tests',
      fullName: 'Test User',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const token = signAccessToken({ sub: user.id, email: user.email, roles, permissions });
  return { userId: user.id, token };
}
