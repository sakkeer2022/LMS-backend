import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { blankPolicyPdf } from '../helpers/pdf.js';
import { publishAllPolicies } from '../helpers/policies.js';
import { seedCountries } from '../helpers/regions.js';
import { prisma } from '@infrastructure/database/index.js';
import { getTestStorage } from '@infrastructure/storage/index.js';
import { loadPlaceholderPolicies, loadPolicyFolder } from '@modules/policies/index.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function folder(manifest: unknown, files: Record<string, Buffer> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amentorz-policies-'));
  dirs.push(dir);
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  for (const [name, bytes] of Object.entries(files))
    await fs.writeFile(path.join(dir, name), bytes);
  return dir;
}

describe('policy loader', () => {
  beforeEach(async () => {
    getTestStorage().clear();
    await seedCountries();
  });

  it('creates marked placeholders so every country can register in development', async () => {
    const report = await loadPlaceholderPolicies();
    expect(report.loaded).toHaveLength(8);
    for (const country of ['IN', 'AE']) {
      const res = await request(app).get(`/api/v1/policies/current?country=${country}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(4);
      expect(res.body.data[0].title).toContain('placeholder');
      expect(res.body.data[0].version).toBe('0.0-placeholder');
    }
  });

  it('never replaces a real version with a placeholder, and can be run again', async () => {
    const real = await publishAllPolicies('IN', '1.0');
    const report = await loadPlaceholderPolicies();
    expect(report.loaded).toHaveLength(4); // only the UAE
    expect(report.skipped).toHaveLength(4);
    const current = await request(app).get('/api/v1/policies/current?country=IN');
    expect(current.body.data.map((p: { id: string }) => p.id)).toEqual(
      Object.values(real).map((p) => p.id)
    );
    expect((await loadPlaceholderPolicies()).loaded).toHaveLength(0);
  });

  it('refuses to create placeholders in production', async () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(loadPlaceholderPolicies()).rejects.toThrow('never created in production');
    } finally {
      process.env.NODE_ENV = before;
    }
    expect(await prisma.policyDocument.count()).toBe(0);
  });

  it('loads the PDFs listed in a manifest and skips a version that already exists', async () => {
    const dir = await folder(
      [
        {
          type: 'student_terms',
          country: 'in',
          version: '1.0',
          title: 'Student Terms',
          effectiveAt: '2026-09-01',
          file: 'student-terms-in.pdf',
        },
        {
          type: 'privacy_policy',
          country: 'AE',
          version: '1.0',
          title: 'Privacy Policy',
          effectiveAt: '2026-09-01',
          file: 'privacy-ae.pdf',
        },
      ],
      { 'student-terms-in.pdf': await blankPolicyPdf(2), 'privacy-ae.pdf': await blankPolicyPdf(1) }
    );
    const first = await loadPolicyFolder(dir);
    expect(first.loaded).toEqual(['student_terms IN 1.0', 'privacy_policy AE 1.0']);
    const second = await loadPolicyFolder(dir);
    expect(second.loaded).toEqual([]);
    expect(second.skipped).toHaveLength(2);
    expect(await prisma.policyDocument.count()).toBe(2);
  });

  it('rejects a bad manifest, a missing file and a file that is not a PDF', async () => {
    await expect(loadPolicyFolder(await folder([{ type: 'faculty_terms' }]))).rejects.toThrow();
    const entry = {
      type: 'student_terms',
      country: 'IN',
      version: '1.0',
      title: 'T',
      effectiveAt: '2026-09-01',
      file: 'missing.pdf',
    };
    await expect(loadPolicyFolder(await folder([entry]))).rejects.toThrow();
    await expect(
      loadPolicyFolder(
        await folder([{ ...entry, file: 'bad.pdf' }], { 'bad.pdf': Buffer.from('not a pdf') })
      )
    ).rejects.toThrow('not a readable PDF');
    expect(await prisma.policyDocument.count()).toBe(0);
  });
});
