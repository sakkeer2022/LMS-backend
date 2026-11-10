import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import {
  Prisma,
  type EducationLevel,
  type GuardianRelationship,
  type PolicyType,
} from '@prisma/client';
import { prisma } from '@infrastructure/database/index.js';
import { ConflictError, ServiceUnavailableError, ValidationError } from '@core/errors/index';
import { completedYears } from '@shared/dates';
import { consumeRegistrationToken } from '@modules/email-otp/index.js';
import { countryFromMobile, isValidMobile } from '@modules/regions/index.js';
import { resolveBookableOffering } from '@modules/category-tree/index.js';
import { logAction } from '@modules/audit/index.js';
import type { RegisterStudentInput } from './registration.dto.js';

const BCRYPT_ROUNDS = 12;
const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

type Tx = Prisma.TransactionClient;

/** Terms of Use and Privacy for everyone; Child Safety as well when the student is under the consent age. */
function requiredPolicyTypes(minor: boolean): PolicyType[] {
  return minor
    ? ['TERMS_OF_USE', 'PRIVACY_POLICY', 'CHILD_SAFETY_POLICY']
    : ['TERMS_OF_USE', 'PRIVACY_POLICY'];
}

/** The accepted ids must be exactly the country's current required policies, nothing more or less. */
async function checkAcceptedPolicies(
  tx: Tx,
  country: string,
  minor: boolean,
  acceptedIds: string[]
): Promise<void> {
  const current = await tx.policyDocument.findMany({
    where: { country, isCurrent: true, type: { in: requiredPolicyTypes(minor) } },
    select: { id: true },
  });
  const expected = new Set(current.map((policy) => policy.id));
  if (
    expected.size !== requiredPolicyTypes(minor).length ||
    acceptedIds.length !== expected.size ||
    !acceptedIds.every((id) => expected.has(id))
  ) {
    throw new ValidationError('Accept the current policies for your country and try again.');
  }
}

/** Every chosen curriculum must exist and be an active offering of a bookable leaf. */
async function checkCurricula(
  tx: Tx,
  profile: RegisterStudentInput['learningProfile']
): Promise<void> {
  const rows = await tx.curriculum.findMany({
    where: { id: { in: profile.curriculumIds }, isActive: true },
  });
  if (rows.length !== profile.curriculumIds.length) {
    throw new ValidationError('One of the chosen subjects is no longer available.');
  }
  for (const row of rows) {
    const offering = await resolveBookableOffering(
      {
        categoryId: row.categoryId,
        subjectId: row.subjectId,
        boardId: row.boardId,
        levelId: row.levelId,
      },
      tx
    );
    if (offering.curriculumId !== row.id) {
      throw new ValidationError('One of the chosen subjects is no longer available.');
    }
  }
}

/** Marks the guardian's signed consent as belonging to this student, if it matches what was submitted. */
async function linkConsent(
  tx: Tx,
  input: RegisterStudentInput,
  country: string,
  studentId: string
): Promise<void> {
  const { guardian, consentToken } = input;
  if (!guardian || !consentToken) {
    throw new ValidationError(
      'A guardian and the guardian signature are required for this student.'
    );
  }
  const consent = await tx.guardianConsent.findUnique({
    where: { tokenHash: sha256(consentToken) },
    include: { policy: { select: { country: true } } },
  });
  const now = new Date();
  if (
    !consent ||
    consent.linkedAt ||
    consent.expiresAt <= now ||
    consent.policy.country !== country ||
    consent.studentFullName !== input.fullName ||
    consent.studentDateOfBirth.toISOString().slice(0, 10) !== input.dateOfBirth
  ) {
    throw new ValidationError('The guardian signature is not valid. Sign it again.');
  }
  // Only an unlinked row is updated, so two registrations cannot share one signature
  const linked = await tx.guardianConsent.updateMany({
    where: { id: consent.id, linkedAt: null },
    data: {
      studentId,
      linkedAt: now,
      guardianName: guardian.fullName,
      guardianRelationship: guardian.relationship.toUpperCase() as GuardianRelationship,
    },
  });
  if (linked.count !== 1) {
    throw new ValidationError('The guardian signature is not valid. Sign it again.');
  }
}

export interface RequestDetails {
  ipAddress: string | null;
  userAgent: string | null;
  traceId?: string | null;
}

/**
 * Onboarding step 4: creates the student in one transaction (user, role, profile, subjects, guardian contact,
 * policy acceptances, linked consent). A failure anywhere gives the email token back, so the student can retry.
 * The caller is not signed in afterwards; the screen sends them to the login.
 */
export async function registerStudent(
  input: RegisterStudentInput,
  request: RequestDetails
): Promise<{ userId: string }> {
  const country = await countryFromMobile(input.mobileNumber);
  if (!country || !(await isValidMobile(input.mobileNumber, country.code))) {
    throw new ValidationError('Enter a mobile number from a country we serve.');
  }
  if (input.guardian && !(await isValidMobile(input.guardian.mobileNumber))) {
    throw new ValidationError('Enter the guardian mobile number with a served country code.');
  }
  const age = completedYears(input.dateOfBirth, new Date()) as number;
  const minor = age < country.guardianConsentAge;
  if (minor && (!input.guardian || !input.consentToken)) {
    throw new ValidationError(
      'A guardian and the guardian signature are required for this student.'
    );
  }
  if (!minor && input.consentToken) {
    throw new ValidationError(
      'A guardian signature is only needed for a student below the required age.'
    );
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const now = new Date();

  const userId = await prisma
    .$transaction(async (tx) => {
      const email = await consumeRegistrationToken(input.emailVerificationToken, tx);
      if (await tx.user.findFirst({ where: { email }, select: { id: true } })) {
        throw new ConflictError('This email is already registered. Sign in instead.');
      }
      if (input.guardian?.email === email) {
        throw new ValidationError('The guardian email must differ from the student email.');
      }
      const role = await tx.role.findUnique({ where: { name: 'student' }, select: { id: true } });
      if (!role) throw new ServiceUnavailableError('Registration is not available right now.');
      const languageId = input.learningProfile.teachingLanguageId ?? null;
      if (
        languageId &&
        !(await tx.teachingLanguage.findFirst({
          where: { id: languageId, isActive: true },
          select: { id: true },
        }))
      ) {
        throw new ValidationError('Choose an available teaching language.');
      }

      if (
        input.referral &&
        !(await tx.referralSource.findFirst({
          where: { code: input.referral.sourceCode, isActive: true },
          select: { code: true },
        }))
      ) {
        throw new ValidationError('Choose one of the listed ways you heard about us.');
      }

      await checkAcceptedPolicies(tx, country.code, minor, input.acceptedPolicyIds);
      await checkCurricula(tx, input.learningProfile);

      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: input.fullName,
          mobileNumber: input.mobileNumber,
          timezone: input.timezone,
          emailVerifiedAt: now,
          roles: { create: { roleId: role.id } },
          policyAcceptances: {
            create: input.acceptedPolicyIds.map((policyId) => ({
              policyId,
              ipAddress: request.ipAddress,
              userAgent: request.userAgent,
              acceptedAt: now,
            })),
          },
        },
        select: { id: true },
      });
      const { guardian, learningProfile } = input;
      const profile = await tx.studentProfile.create({
        data: {
          userId: user.id,
          dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00Z`),
          country: country.code,
          teachingLanguageId: languageId,
          referralSourceCode: input.referral?.sourceCode ?? null,
          referralSourceOther: input.referral?.other ?? null,
          educationLevel:
            (input.education?.level?.toUpperCase() as EducationLevel | undefined) ?? null,
          institutionName: input.education?.institutionName ?? null,
          educationDetail: input.education?.detail ?? null,
          ...(guardian && {
            guardianName: guardian.fullName,
            guardianRelationship: guardian.relationship.toUpperCase() as GuardianRelationship,
            guardianMobileNumber: guardian.mobileNumber,
            guardianEmail: guardian.email,
            guardianReceivesReports: guardian.receivesReportsAndReceipts,
          }),
          subjects: {
            create: learningProfile.curriculumIds.map((curriculumId) => ({ curriculumId })),
          },
        },
        select: { id: true },
      });
      if (minor) await linkConsent(tx, input, country.code, profile.id);
      return user.id;
    })
    .catch((error: unknown) => {
      // Two requests with one verified email: the loser hits the unique index
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('This email is already registered. Sign in instead.');
      }
      throw error;
    });

  await logAction({
    actorId: userId,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
    traceId: request.traceId ?? null,
    entity: 'user',
    action: 'student.registered',
    resourceId: userId,
    newValue: { country: country.code, minor, policyIds: input.acceptedPolicyIds },
  });
  return { userId };
}
