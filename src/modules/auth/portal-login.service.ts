import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { prisma } from '@infrastructure/database/index';
import { ForbiddenError, UnauthorizedError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { config } from '@config/index';
import { PORTAL_ROLES, type Portal } from '@core/security/rbac';
import { logAction } from '../audit/audit.service.js';
import type { PortalLoginInput } from './auth.dto.js';
import { assessLoginLocation, type SessionContext } from './auth.service.js';
import { issueTokenPair } from './session.js';
import { supersedeDeviceSessions } from './session.service.js';
import { loadContractUser, type ContractUser } from './contract-user.js';
import { assertFacultyCanSignIn } from '@modules/faculty/index';

export interface PortalLoginResult {
  user: ContractUser;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
  remember: boolean;
  accessExpiresAt: Date;
  sessionExpiresAt: Date;
  requiresTermsAcceptance: boolean;
  requiresPasswordChange: boolean;
}

const GENERIC_MESSAGE = 'Invalid email or password';
const BCRYPT_ROUNDS = 12;

// Compared against when the email is unknown so the response time does not reveal it
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash('amentorz-no-such-account', BCRYPT_ROUNDS);
  return dummyHash;
}

type FailureReason =
  | 'unknown_account'
  | 'account_locked'
  | 'wrong_password'
  | 'account_inactive'
  | 'wrong_portal'
  | 'email_unverified'
  | 'faculty_not_ready';

async function auditFailure(
  portal: Portal,
  reason: FailureReason,
  context: SessionContext,
  actorId: string | null
): Promise<void> {
  logger.warn({ type: 'security', event: 'FAILED_LOGIN', portal, reason, actorId });
  await logAction({
    actorId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    deviceFingerprint: context.deviceFingerprint,
    severity: 'SECURITY',
    entity: 'auth',
    action: 'login.failed',
    resourceId: actorId,
    newValue: { portal, reason },
  });
}

/**
 * Signs a user in to one portal. Every failure up to the email check returns the same 401 and
 * sets no cookie; the failure reason is recorded in the audit log only. The password is checked
 * before the role so a wrong portal never reveals whether the password was right.
 */
export async function loginToPortal(
  portal: Portal,
  dto: PortalLoginInput,
  context: SessionContext
): Promise<PortalLoginResult> {
  const user = await prisma.user.findFirst({
    where: { email: dto.email, deletedAt: null },
    include: { roles: { select: { role: { select: { name: true } } } } },
  });

  const passwordOk = await bcrypt.compare(
    dto.password,
    user?.passwordHash ?? (await getDummyHash())
  );
  const fail = async (reason: FailureReason): Promise<never> => {
    await auditFailure(portal, reason, context, user?.id ?? null);
    throw new UnauthorizedError(GENERIC_MESSAGE);
  };

  if (!user) return fail('unknown_account');
  if (user.lockedUntil && user.lockedUntil > new Date()) return fail('account_locked');

  if (!passwordOk) {
    const attempts = user.failedLoginAttempts + 1;
    const locked = attempts >= config.security.maxFailedLogins;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        ...(locked && {
          lockedUntil: new Date(Date.now() + config.security.lockoutDurationMinutes * 60 * 1000),
        }),
      },
    });
    return fail('wrong_password');
  }

  if (!user.isActive || user.status === 'INACTIVE' || user.status === 'SUSPENDED') {
    return fail('account_inactive');
  }

  const allowed = PORTAL_ROLES[portal];
  if (!user.roles.some((ur) => allowed.includes(ur.role.name))) return fail('wrong_portal');

  if (!user.emailVerifiedAt) {
    await auditFailure(portal, 'email_unverified', context, user.id);
    throw new ForbiddenError('Email address is not verified');
  }

  // Faculty (LMS-39): approved and every subject priced, else 403 with a code saying why
  let requiresPriceConsent = false;
  if (portal === 'faculty') {
    try {
      ({ requiresPriceConsent } = await assertFacultyCanSignIn(user.id));
    } catch (err) {
      await auditFailure(portal, 'faculty_not_ready', context, user.id);
      throw err;
    }
  }

  const country = await assessLoginLocation(user, context);

  const familyId = crypto.randomUUID();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: context.ipAddress,
        lastLoginCountry: country,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    const tokens = await issueTokenPair(updated, context, tx, {
      portal,
      familyId,
      remember: dto.rememberMe,
    });
    return { tokens, contractUser: await loadContractUser(user.id, tx) };
  });

  await supersedeDeviceSessions(user.id, portal, context.deviceFingerprint, familyId);

  await logAction({
    actorId: user.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    deviceFingerprint: context.deviceFingerprint,
    severity: 'INFO',
    entity: 'auth',
    action: 'login.success',
    resourceId: user.id,
    newValue: { portal },
  });

  const { sessionExpiresAt, ...tokens } = result.tokens;
  return {
    user: result.contractUser,
    tokens,
    remember: dto.rememberMe,
    accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
    sessionExpiresAt,
    // Faculty: the session prices still need the tutor's acceptance (price consent screen)
    requiresTermsAcceptance: requiresPriceConsent,
    requiresPasswordChange: user.status === 'PENDING_ACTIVATION',
  };
}
