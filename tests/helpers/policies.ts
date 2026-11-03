import type { PolicyType } from '@prisma/client';
import { publishPolicy, REQUIRED_POLICY_TYPES, type PolicyView } from '@modules/policies/index.js';

/** A tiny stand-in PDF whose bytes differ by country, type and version, so tests can tell them apart. */
export const fakePdf = (label: string): Buffer => Buffer.from(`%PDF-1.7\n% ${label}\n%%EOF`);

/** Publishes the four current policies for a country and returns them by type. */
export async function publishAllPolicies(
  country: string,
  version = '1.0'
): Promise<Record<PolicyType, PolicyView>> {
  const result = {} as Record<PolicyType, PolicyView>;
  for (const type of REQUIRED_POLICY_TYPES) {
    result[type] = await publishPolicy({
      type,
      country,
      version,
      title: type.toLowerCase().replaceAll('_', ' '),
      effectiveAt: new Date('2026-09-01T00:00:00Z'),
      pdf: fakePdf(`${country} ${type} ${version}`),
    });
  }
  return result;
}
