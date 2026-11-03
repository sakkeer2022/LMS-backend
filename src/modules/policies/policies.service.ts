import type { PolicyDocument, PolicyType } from '@prisma/client';
import { prisma } from '@infrastructure/database/index.js';
import { getStorage, sha256Hex } from '@infrastructure/storage/index.js';
import { logger } from '@core/logger/index';
import { NotFoundError, ServiceUnavailableError, ValidationError } from '@core/errors/index';
import { getCountry } from '@modules/regions/index.js';

/** The four policies every student sees, one current version each, per country. */
export const REQUIRED_POLICY_TYPES: readonly PolicyType[] = [
  'TERMS_OF_USE',
  'PRIVACY_POLICY',
  'CHILD_SAFETY_POLICY',
  'STUDENT_TERMS',
];

export interface PolicyView {
  id: string;
  type: Lowercase<PolicyType>;
  country: string;
  version: string;
  title: string;
  effectiveAt: Date;
  sha256: string;
}

const toView = (row: PolicyDocument): PolicyView => ({
  id: row.id,
  type: row.type.toLowerCase() as Lowercase<PolicyType>,
  country: row.country,
  version: row.version,
  title: row.title,
  effectiveAt: row.effectiveAt,
  sha256: row.sha256,
});

/**
 * The current version of each policy for a country. A country without all four texts is a 503 until they
 * are loaded: it never receives another country's legal text (REGIONS.md rule 4).
 */
export async function listCurrentPolicies(countryCode: string): Promise<PolicyView[]> {
  if (!(await getCountry(countryCode)))
    throw new ValidationError('This country is not supported yet.');
  const rows = await prisma.policyDocument.findMany({
    where: { country: countryCode, isCurrent: true },
    orderBy: { type: 'asc' },
  });
  const byType = new Map(rows.map((row) => [row.type, row]));
  const ordered = REQUIRED_POLICY_TYPES.map((type) => byType.get(type));
  if (ordered.some((row) => row === undefined)) {
    throw new ServiceUnavailableError('The policies for this country are not available yet.');
  }
  return ordered.map((row) => toView(row as PolicyDocument));
}

export interface PolicyFile {
  bytes: Buffer;
  sha256: string;
  fileName: string;
}

/** The bytes of one policy version. Its stored hash is checked on every read. */
export async function getPolicyFile(policyId: string): Promise<PolicyFile> {
  const policy = await prisma.policyDocument.findUnique({ where: { id: policyId } });
  if (!policy) throw new NotFoundError('Policy');
  const bytes = await getStorage().get(policy.storageKey);
  if (!bytes) {
    logger.error({ policyId, key: policy.storageKey }, 'policy file is missing from storage');
    throw new ServiceUnavailableError('The policy document is not available right now.');
  }
  if (sha256Hex(bytes) !== policy.sha256) {
    logger.error(
      { policyId, key: policy.storageKey },
      'policy file does not match its stored hash'
    );
    throw new ServiceUnavailableError('The policy document is not available right now.');
  }
  return {
    bytes,
    sha256: policy.sha256,
    fileName: `${policy.type.toLowerCase().replaceAll('_', '-')}-${policy.country.toLowerCase()}-${policy.version}.pdf`,
  };
}

export interface NewPolicy {
  type: PolicyType;
  country: string;
  version: string;
  title: string;
  effectiveAt: Date;
  pdf: Buffer;
}

const keyFor = (policy: Pick<NewPolicy, 'type' | 'country' | 'version'>): string =>
  `policies/${policy.type.toLowerCase().replaceAll('_', '-')}/${policy.country.toLowerCase()}/${policy.version}.pdf`;

/**
 * Stores a policy PDF and makes it the current version for its type and country, in one transaction (the
 * previous current version stays on record: acceptances and consents point at it). Used by the loader.
 */
export async function publishPolicy(input: NewPolicy): Promise<PolicyView> {
  if (!(await getCountry(input.country)))
    throw new ValidationError('This country is not supported yet.');
  const stored = await getStorage().put(keyFor(input), input.pdf, 'application/pdf');
  const row = await prisma.$transaction(async (tx) => {
    await tx.policyDocument.updateMany({
      where: { type: input.type, country: input.country, isCurrent: true },
      data: { isCurrent: false },
    });
    return tx.policyDocument.create({
      data: {
        type: input.type,
        country: input.country,
        version: input.version,
        title: input.title,
        effectiveAt: input.effectiveAt,
        storageKey: stored.key,
        sha256: stored.sha256,
        isCurrent: true,
      },
    });
  });
  return toView(row);
}
