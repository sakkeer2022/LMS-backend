import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { PolicyType } from '@prisma/client';
import { prisma } from '../src/infrastructure/database/connection.js';
import { listCountries } from '../src/modules/regions/index.js';
import { REQUIRED_POLICY_TYPES, uploadPolicy } from '../src/modules/policies/policies.service.js';
import {
  placeholderPolicyPdf,
  placeholderTitle,
} from '../src/modules/policies/placeholder-policy.js';

/**
 * Loads policy documents without the admin screen, for the first setup.
 *
 *   npm run policies:load -- --dir ./policies          reads ./policies/manifest.json
 *   npm run policies:load -- --placeholders            development only: marked stand-ins for any country
 *                                                      and policy type that has no current version
 *
 * manifest.json is a list of { type, country, version, title, effectiveAt, file } where `file` is a PDF in
 * the same folder (type is terms_of_use, privacy_policy, child_safety_policy or student_terms). A version
 * that already exists is skipped, not replaced.
 */
const Manifest = z.array(
  z.strictObject({
    type: z.enum(['terms_of_use', 'privacy_policy', 'child_safety_policy', 'student_terms']),
    country: z
      .string()
      .length(2)
      .transform((value) => value.toUpperCase()),
    version: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,19}$/),
    title: z.string().min(1).max(200),
    effectiveAt: z.string(),
    file: z.string().min(1),
  })
);

const audit = { actorId: null, ipAddress: null, userAgent: 'policies:load' };

async function loadFolder(dir: string): Promise<void> {
  const entries = Manifest.parse(
    JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'))
  );
  for (const entry of entries) {
    const type = entry.type.toUpperCase() as PolicyType;
    const exists = await prisma.policyDocument.findFirst({
      where: { type, country: entry.country, version: entry.version },
    });
    if (exists) {
      console.log(`skip   ${entry.type} ${entry.country} ${entry.version} (already loaded)`);
      continue;
    }
    const pdf = await fs.readFile(path.join(dir, path.basename(entry.file)));
    await uploadPolicy(
      {
        type,
        country: entry.country,
        version: entry.version,
        title: entry.title,
        effectiveAt: new Date(entry.effectiveAt),
        pdf,
      },
      audit
    );
    console.log(`loaded ${entry.type} ${entry.country} ${entry.version}`);
  }
}

async function loadPlaceholders(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Placeholder policies are for development only and are never created in production.'
    );
  }
  for (const country of await listCountries()) {
    for (const type of REQUIRED_POLICY_TYPES) {
      const current = await prisma.policyDocument.findFirst({
        where: { type, country: country.code, isCurrent: true },
      });
      if (current) continue;
      await uploadPolicy(
        {
          type,
          country: country.code,
          version: '0.0-placeholder',
          title: placeholderTitle(type),
          effectiveAt: new Date(),
          pdf: await placeholderPolicyPdf(type, country.name),
        },
        audit
      );
      console.log(`placeholder ${type} ${country.code}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  if (args.includes('--placeholders')) await loadPlaceholders();
  else if (dirIndex >= 0 && args[dirIndex + 1]) await loadFolder(path.resolve(args[dirIndex + 1]!));
  else
    throw new Error('Use --dir <folder with manifest.json> or --placeholders (development only).');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
