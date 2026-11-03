import crypto from 'node:crypto';
import type { ChallengePurpose, Prisma } from '@prisma/client';
import { config } from '@config/index';
import { prisma } from '@infrastructure/database/index.js';
import { getEmailSender, otpEmail, type OtpPurposeCopy } from '@infrastructure/email/index.js';
import { TooManyRequestsError, ValidationError } from '@core/errors/index';
import { logger } from '@core/logger/index';

export interface IssuedChallenge {
  challengeId: string;
  expiresAt: Date;
  resendAfter: Date;
}

export interface VerifiedOtp {
  email: string;
  userId: string | null;
  /** Single-use token for REGISTRATION challenges; its hash is the only copy stored. */
  token?: { value: string; expiresAt: Date };
}

const COPY_FOR: Partial<Record<ChallengePurpose, OtpPurposeCopy>> = {
  REGISTRATION: 'registration',
  PASSWORD_RECOVERY: 'recovery',
};

// The OTP key is derived from the JWT secret, so no extra secret has to be provisioned. A 6-digit code
// under a plain hash could be enumerated from a database leak; the keyed hash cannot.
const otpKey = (): Buffer =>
  crypto.createHmac('sha256', config.jwt.secret).update('email-otp:v1').digest();

function otpHash(challengeId: string, code: string): string {
  return crypto.createHmac('sha256', otpKey()).update(`${challengeId}:${code}`).digest('hex');
}

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const INVALID_CODE = 'The code is invalid or has expired. Request a new one.';

/**
 * Creates a challenge and emails its code. A new challenge replaces any live one for the same email and
 * purpose. `deliver: false` creates an undeliverable decoy so a caller can answer an ineligible address
 * (for example an email that is already registered) exactly like an eligible one.
 */
export async function issueEmailOtp(input: {
  email: string;
  purpose: ChallengePurpose;
  userId?: string;
  deliver?: boolean;
}): Promise<IssuedChallenge> {
  const email = normalizeEmail(input.email);
  const now = new Date();
  const challengeId = crypto.randomUUID();
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const expiresAt = new Date(now.getTime() + config.otp.expiresMinutes * 60_000);
  const resendAfter = new Date(now.getTime() + config.otp.resendCooldownSeconds * 1000);

  await prisma.$transaction(async (tx) => {
    const live = await tx.emailChallenge.findFirst({
      where: { email, purpose: input.purpose, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (live && live.resendCooldownUntil > now) {
      const wait = Math.ceil((live.resendCooldownUntil.getTime() - now.getTime()) / 1000);
      throw new TooManyRequestsError(`Please wait ${wait} seconds before asking for a new code.`);
    }
    await tx.emailChallenge.updateMany({
      where: { email, purpose: input.purpose, consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.emailChallenge.create({
      data: {
        id: challengeId,
        email,
        purpose: input.purpose,
        userId: input.userId ?? null,
        otpHash: otpHash(challengeId, code),
        attemptsRemaining: config.otp.maxAttempts,
        expiresAt,
        resendCooldownUntil: resendAfter,
      },
    });
  });

  const copy = COPY_FOR[input.purpose];
  if (input.deliver !== false && copy) {
    const message = otpEmail(copy, code, config.otp.expiresMinutes);
    try {
      await getEmailSender().send({ to: email, ...message });
    } catch (error) {
      // The caller still answers uniformly; the person can ask again after the cooldown
      logger.error({ err: error, purpose: input.purpose }, 'could not send the one-time code');
    }
  }
  return { challengeId, expiresAt, resendAfter };
}

/**
 * Checks a code against its challenge. Wrong, expired, used and unknown all give the same 422; running out
 * of attempts gives 429. A correct code is consumed exactly once, even under concurrent requests.
 */
export async function verifyEmailOtp(input: {
  challengeId: string;
  otp: string;
  purpose: ChallengePurpose;
}): Promise<VerifiedOtp> {
  const now = new Date();
  const challenge = await prisma.emailChallenge.findFirst({
    where: {
      id: input.challengeId,
      purpose: input.purpose,
      consumedAt: null,
      expiresAt: { gt: now },
    },
  });
  if (!challenge) throw new ValidationError(INVALID_CODE);
  if (challenge.attemptsRemaining <= 0) {
    throw new TooManyRequestsError('Too many wrong codes. Request a new one.');
  }

  const given = Buffer.from(otpHash(challenge.id, input.otp), 'hex');
  const stored = Buffer.from(challenge.otpHash, 'hex');
  if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
    await prisma.emailChallenge.updateMany({
      where: { id: challenge.id, attemptsRemaining: { gt: 0 } },
      data: { attemptsRemaining: { decrement: 1 } },
    });
    throw new ValidationError(INVALID_CODE);
  }

  const token =
    input.purpose === 'REGISTRATION'
      ? {
          value: crypto.randomBytes(32).toString('base64url'),
          expiresAt: new Date(now.getTime() + config.otp.emailTokenExpiresMinutes * 60_000),
        }
      : undefined;
  const consumed = await prisma.emailChallenge.updateMany({
    where: {
      id: challenge.id,
      consumedAt: null,
      attemptsRemaining: { gt: 0 },
      expiresAt: { gt: now },
    },
    data: {
      consumedAt: now,
      ...(token && {
        registrationTokenHash: sha256(token.value),
        registrationTokenExpiresAt: token.expiresAt,
      }),
    },
  });
  if (consumed.count !== 1) throw new ValidationError(INVALID_CODE);
  return { email: challenge.email, userId: challenge.userId, ...(token && { token }) };
}

/**
 * Uses up a registration email token inside the registration transaction and returns the verified email.
 * Unknown, expired and already used tokens all give the same 422.
 */
export async function consumeRegistrationToken(
  token: string,
  tx: Prisma.TransactionClient = prisma
): Promise<string> {
  const now = new Date();
  const hash = sha256(token);
  const challenge = await tx.emailChallenge.findUnique({ where: { registrationTokenHash: hash } });
  if (
    !challenge ||
    challenge.registrationTokenConsumedAt ||
    !challenge.registrationTokenExpiresAt ||
    challenge.registrationTokenExpiresAt <= now
  ) {
    throw new ValidationError('The email verification has expired. Verify your email again.');
  }
  const used = await tx.emailChallenge.updateMany({
    where: { id: challenge.id, registrationTokenConsumedAt: null },
    data: { registrationTokenConsumedAt: now },
  });
  if (used.count !== 1)
    throw new ValidationError('The email verification has expired. Verify your email again.');
  return challenge.email;
}
