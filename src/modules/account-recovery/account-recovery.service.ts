import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { config } from '@config/index';
import { prisma } from '@infrastructure/database/index';
import { PORTAL_ROLES } from '@core/security/rbac';
import { TooManyRequestsError, ValidationError } from '@core/errors/index';
import { issueEmailOtp, verifyEmailOtp, type IssuedChallenge } from '@modules/email-otp/index.js';
import { revokeAllSessions } from '@modules/auth/index.js';
import { logAction, type AuditContext } from '../audit/audit.service.js';
import type {
  PasswordChange,
  PasswordReset,
  RecoveryRequest,
  RecoveryVerify,
} from './account-recovery.dto.js';

const BCRYPT_ROUNDS = 12;
const INVALID_RESET = 'The reset link has expired. Start again from "Forgot password?".';

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Sends a recovery code. The answer is the same for an unknown email, a wrong portal and an inactive
 * account: those get an undeliverable decoy challenge, so this cannot be used to find out who is registered.
 * An account waiting for activation (a faculty member an admin created) can recover, which is how it sets
 * its first password.
 */
export async function requestRecovery(input: RecoveryRequest): Promise<IssuedChallenge> {
  const user = await prisma.user.findFirst({
    where: {
      email: input.email,
      deletedAt: null,
      status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] },
    },
    include: { roles: { include: { role: { select: { name: true } } } } },
  });
  const allowed = PORTAL_ROLES[input.portal];
  const eligible = user !== null && user.roles.some((ur) => allowed.includes(ur.role.name));

  const challenge = await issueEmailOtp({
    email: input.email,
    purpose: 'PASSWORD_RECOVERY',
    ...(eligible && { userId: user.id }),
    deliver: eligible,
  });
  if (eligible) {
    // A new request replaces any reset credential that was not used yet
    await prisma.passwordResetGrant.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }
  return challenge;
}

/** Exchanges a correct code for a short-lived, single-use reset credential (only its hash is stored). */
export async function verifyRecovery(
  input: RecoveryVerify
): Promise<{ resetCredential: string; expiresAt: Date }> {
  const verified = await verifyEmailOtp({ ...input, purpose: 'PASSWORD_RECOVERY' });
  if (!verified.userId)
    throw new ValidationError('The code is invalid or has expired. Request a new one.');

  const resetCredential = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.otp.resetGrantExpiresMinutes * 60_000);
  await prisma.$transaction([
    prisma.passwordResetGrant.updateMany({
      where: { userId: verified.userId, consumedAt: null },
      data: { consumedAt: now },
    }),
    prisma.passwordResetGrant.create({
      data: { userId: verified.userId, grantHash: sha256(resetCredential), expiresAt },
    }),
  ]);
  return { resetCredential, expiresAt };
}

/**
 * Sets a new password from a reset credential. One credential works once, even for simultaneous requests.
 * Every session ends and every other recovery or verification credential is cancelled. The person is not
 * signed in; they log in with the new password.
 */
export async function resetPassword(input: PasswordReset, audit: AuditContext): Promise<void> {
  const now = new Date();
  const grant = await prisma.passwordResetGrant.findUnique({
    where: { grantHash: sha256(input.resetCredential) },
    include: { user: true },
  });
  if (!grant || grant.consumedAt || grant.expiresAt <= now)
    throw new ValidationError(INVALID_RESET);
  if (grant.user.deletedAt || !['ACTIVE', 'PENDING_ACTIVATION'].includes(grant.user.status)) {
    throw new ValidationError(INVALID_RESET);
  }
  if (await bcrypt.compare(input.newPassword, grant.user.passwordHash)) {
    throw new ValidationError('Choose a password you have not used before.');
  }

  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  await prisma.$transaction(async (tx) => {
    const used = await tx.passwordResetGrant.updateMany({
      where: { id: grant.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (used.count !== 1) throw new ValidationError(INVALID_RESET);
    await tx.user.update({
      where: { id: grant.userId },
      data: {
        passwordHash,
        status: grant.user.status === 'PENDING_ACTIVATION' ? 'ACTIVE' : grant.user.status,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await tx.passwordResetGrant.updateMany({
      where: { userId: grant.userId, consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.emailChallenge.updateMany({
      where: { userId: grant.userId, consumedAt: null },
      data: { consumedAt: now },
    });
  });

  await revokeAllSessions(grant.userId);
  await logAction({
    ...audit,
    actorId: grant.userId,
    severity: 'SECURITY',
    entity: 'auth',
    action: 'password.reset',
    resourceId: grant.userId,
  });
}

/**
 * Changes the signed-in user's own password. The current password is checked first (a wrong one counts
 * toward the account lockout, like a wrong login), and the new one must differ. Every session ends,
 * including this one, so the person signs in again with the new password.
 */
export async function changePassword(
  userId: string,
  input: PasswordChange,
  audit: AuditContext
): Promise<void> {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user || !user.isActive) throw new ValidationError('Unable to change the password.');
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new TooManyRequestsError('Too many failed attempts. Please try again later.');
  }

  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
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
    await logAction({
      ...audit,
      actorId: user.id,
      severity: 'SECURITY',
      entity: 'auth',
      action: 'password.change_failed',
      resourceId: user.id,
    });
    throw new ValidationError('The current password is incorrect.');
  }
  if (input.newPassword === input.currentPassword) {
    throw new ValidationError('The new password must be different from the current one.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS),
      status: user.status === 'PENDING_ACTIVATION' ? 'ACTIVE' : user.status,
      failedLoginAttempts: 0,
    },
  });
  await revokeAllSessions(user.id);
  await logAction({
    ...audit,
    actorId: user.id,
    severity: 'SECURITY',
    entity: 'auth',
    action: 'password.changed',
    resourceId: user.id,
  });
}
