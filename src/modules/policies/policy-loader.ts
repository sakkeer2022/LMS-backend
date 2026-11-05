import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { PolicyType } from '@prisma/client';
import { prisma } from '@infrastructure/database/index.js';
import { listCountries } from '@modules/regions/index.js';
import { placeholderPolicyPdf, placeholderTitle } from './placeholder-policy.js';
import { REQUIRED_POLICY_TYPES, uploadPolicy } from './policies.service.js';

const Manifest = z.array(
  z.strictObject({
    type: z.enum(['terms_of_use', 'privacy_policy', 'child_safety_policy', 'student_terms']),
    country: z
      .string()
      .length(2)
      .transform((value) => value.toUpperCase()),
    version: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,19}$/),
    title: z.string().min(1).max(200),
    effectiveAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date'),
    file: z.string().min(1),
  })
);

const audit = { actorId: null, ipAddress: null, userAgent: 'policies:load' };

export interface LoadReport {
  loaded: string[];
  skipped: string[];
}

/**
 * Loads policy PDFs listed in `<dir>/manifest.json` (a list of { type, country, version, title, effectiveAt,
 * file }, `file` being a PDF in the same folder). A version that already exists is skipped, never replaced.
 */
export async function loadPolicyFolder(dir: string): Promise<LoadReport> {
  const entries = Manifest.parse(
    JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'))
  );
  const report: LoadReport = { loaded: [], skipped: [] };
  for (const entry of entries) {
    const type = entry.type.toUpperCase() as PolicyType;
    const label = `${entry.type} ${entry.country} ${entry.version}`;
    const exists = await prisma.policyDocument.findFirst({
      where: { type, country: entry.country, version: entry.version },
    });
    if (exists) {
      report.skipped.push(label);
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
    report.loaded.push(label);
  }
  return report;
}

/**
 * Development only: marked stand-in policies for every active country and policy type that has no current
 * version. Real versions are never replaced. Refuses to run in production.
 */
export async function loadPlaceholderPolicies(): Promise<LoadReport> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Placeholder policies are for development only and are never created in production.'
    );
  }
  const report: LoadReport = { loaded: [], skipped: [] };
  for (const country of await listCountries()) {
    for (const type of REQUIRED_POLICY_TYPES) {
      const label = `${type} ${country.code}`;
      const current = await prisma.policyDocument.findFirst({
        where: { type, country: country.code, isCurrent: true },
      });
      if (current) {
        report.skipped.push(label);
        continue;
      }
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
      report.loaded.push(label);
    }
  }
  return report;
}
