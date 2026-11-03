import type { PolicyDocument, PolicyType } from '@prisma/client';
import { prisma } from '@infrastructure/database/index.js';
import { getStorage, sha256Hex } from '@infrastructure/storage/index.js';
import { getPdfService } from '@infrastructure/pdf/index.js';
import { logger } from '@core/logger/index';
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '@core/errors/index';
import { getCountry, listCountries } from '@modules/regions/index.js';
import { logAction, type AuditContext } from '../audit/audit.service.js';

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

export interface AdminPolicyView extends PolicyView {
  isCurrent: boolean;
  createdAt: Date;
}

const toAdminView = (row: PolicyDocument): AdminPolicyView => ({
  ...toView(row),
  isCurrent: row.isCurrent,
  createdAt: row.createdAt,
});

/** Every uploaded version for the Legal documents screen, newest first. */
export async function listAllPolicies(filter: {
  country?: string;
  type?: PolicyType;
}): Promise<AdminPolicyView[]> {
  const rows = await prisma.policyDocument.findMany({
    where: {
      ...(filter.country && { country: filter.country }),
      ...(filter.type && { type: filter.type }),
    },
    orderBy: [{ country: 'asc' }, { type: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });
  return rows.map(toAdminView);
}

export interface PolicyCoverage {
  country: string;
  name: string;
  missingTypes: Lowercase<PolicyType>[];
}

/** For each active country, the policy types without a current version (students there cannot register). */
export async function getPolicyCoverage(): Promise<PolicyCoverage[]> {
  const [countries, current] = await Promise.all([
    listCountries(),
    prisma.policyDocument.findMany({
      where: { isCurrent: true },
      select: { country: true, type: true },
    }),
  ]);
  return countries.map((country) => {
    const have = new Set(
      current.filter((row) => row.country === country.code).map((row) => row.type)
    );
    return {
      country: country.code,
      name: country.name,
      missingTypes: REQUIRED_POLICY_TYPES.filter((type) => !have.has(type)).map(
        (type) => type.toLowerCase() as Lowercase<PolicyType>
      ),
    };
  });
}

/**
 * Admin upload: checks the file is a readable PDF, refuses a version that already exists for the type and
 * country, stores it and makes it current. The old version stays on record. Audited.
 */
export async function uploadPolicy(
  input: NewPolicy,
  audit: AuditContext
): Promise<AdminPolicyView> {
  try {
    await getPdfService().inspect(input.pdf);
  } catch {
    throw new ValidationError('The file is not a readable PDF.');
  }
  const exists = await prisma.policyDocument.findUnique({
    where: {
      uk_policy_type_country_version: {
        type: input.type,
        country: input.country,
        version: input.version,
      },
    },
    select: { id: true },
  });
  if (exists) throw new ConflictError('That version already exists for this policy and country.');

  const published = await publishPolicy(input);
  await logAction({
    ...audit,
    severity: 'SECURITY',
    entity: 'policy',
    action: 'policy.published',
    resourceId: published.id,
    newValue: {
      type: input.type,
      country: input.country,
      version: input.version,
      sha256: published.sha256,
    },
  });
  const row = await prisma.policyDocument.findUniqueOrThrow({ where: { id: published.id } });
  return toAdminView(row);
}

/** Makes an earlier version current again (to roll back a wrong upload). Audited. */
export async function setPolicyCurrent(
  policyId: string,
  audit: AuditContext
): Promise<AdminPolicyView> {
  const target = await prisma.policyDocument.findUnique({ where: { id: policyId } });
  if (!target) throw new NotFoundError('Policy');
  const updated = await prisma.$transaction(async (tx) => {
    await tx.policyDocument.updateMany({
      where: {
        type: target.type,
        country: target.country,
        isCurrent: true,
        id: { not: target.id },
      },
      data: { isCurrent: false },
    });
    return tx.policyDocument.update({ where: { id: target.id }, data: { isCurrent: true } });
  });
  await logAction({
    ...audit,
    severity: 'SECURITY',
    entity: 'policy',
    action: 'policy.set_current',
    resourceId: target.id,
    newValue: { type: target.type, country: target.country, version: target.version },
  });
  return toAdminView(updated);
}
