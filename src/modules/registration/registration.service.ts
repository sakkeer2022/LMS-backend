import { prisma } from '@infrastructure/database/index.js';
import { issueEmailOtp, verifyEmailOtp, type IssuedChallenge } from '@modules/email-otp/index.js';
import type { RegistrationEmailRequest, RegistrationOtpVerify } from './registration.dto.js';

/**
 * Onboarding step 1. The answer is the same whether or not the address already has an account (decision
 * recorded in docs/PENDING_DECISIONS.md): an existing address gets an undeliverable decoy challenge, so
 * the screen cannot be used to find out who is registered. The person learns at the final submit (409).
 */
export async function requestRegistrationOtp(
  input: RegistrationEmailRequest
): Promise<IssuedChallenge> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  return issueEmailOtp({ email: input.email, purpose: 'REGISTRATION', deliver: !existing });
}

/** The active "how did you hear about us" options in display order. */
export function listReferralSources(): Promise<{ code: string; name: string }[]> {
  return prisma.referralSource.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
    select: { code: true, name: true },
  });
}

/** Verifies the code and returns the single-use email token that POST /auth/register consumes. */
export async function verifyRegistrationOtp(
  input: RegistrationOtpVerify
): Promise<{ emailVerificationToken: string; expiresAt: Date }> {
  const verified = await verifyEmailOtp({
    challengeId: input.challengeId,
    otp: input.otp,
    purpose: 'REGISTRATION',
  });
  // A REGISTRATION challenge always issues a token
  if (!verified.token) throw new Error('Registration challenge did not issue a token');
  return { emailVerificationToken: verified.token.value, expiresAt: verified.token.expiresAt };
}
