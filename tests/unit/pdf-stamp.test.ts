import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getPdfService, isPng } from '@infrastructure/pdf/index.js';
import { scriptOf, splitRuns } from '@infrastructure/pdf/fonts.js';
import { sha256Hex } from '@infrastructure/storage/index.js';
import { TINY_PNG, blankPolicyPdf, strokePng } from '../helpers/pdf.js';

const NAMES: [string, string][] = [
  ['plain Latin', 'Ananya Sharma'],
  ['Latin with accents', 'Zoë Müller-Çelik'],
  ['Devanagari with conjuncts', 'अनन्या शर्मा क्षत्रिय'],
  ['Arabic', 'محمد عبد الله'],
  ['mixed scripts', 'Priya प्रिया'],
  ['very long', 'Venkata Subramanian Ramaswamy Iyer '.repeat(4).trim()],
];

describe('consent stamping', () => {
  it.each(NAMES)('stamps a name in %s onto a new last page', async (_label, name) => {
    const base = await blankPolicyPdf(2);
    const stamped = await getPdfService().stampConsent({
      basePdf: base,
      signaturePng: await strokePng(),
      studentFullName: name,
      signedAt: new Date('2026-11-03T10:15:30Z'),
      ipAddress: '203.0.113.7',
      policySha256: sha256Hex(base),
    });
    const doc = await PDFDocument.load(stamped);
    expect(doc.getPageCount()).toBe(3);
    // The policy pages keep their size and the stamp page matches them
    expect(doc.getPage(2).getSize()).toEqual(doc.getPage(1).getSize());
  });

  it('accepts a minimal one-pixel signature and does not change the original bytes', async () => {
    const base = await blankPolicyPdf(1);
    const before = Buffer.from(base);
    const stamped = await getPdfService().stampConsent({
      basePdf: base,
      signaturePng: TINY_PNG,
      studentFullName: 'A B',
      signedAt: new Date(),
      ipAddress: '2001:db8::1',
      policySha256: sha256Hex(base),
    });
    expect(base.equals(before)).toBe(true);
    expect(stamped.equals(base)).toBe(false);
    expect((await PDFDocument.load(stamped)).getPageCount()).toBe(2);
  });

  it('rejects a base file that is not a PDF', async () => {
    await expect(
      getPdfService().stampConsent({
        basePdf: Buffer.from('not a pdf'),
        signaturePng: TINY_PNG,
        studentFullName: 'A B',
        signedAt: new Date(),
        ipAddress: '1.1.1.1',
        policySha256: 'a'.repeat(64),
      })
    ).rejects.toThrow();
  });
});

describe('PNG check and script runs', () => {
  it('recognises a PNG by its signature, not its name', async () => {
    expect(isPng(TINY_PNG)).toBe(true);
    expect(isPng(Buffer.from('GIF89a......'))).toBe(false);
    expect(isPng(Buffer.from('%PDF-1.7 ....'))).toBe(false);
  });

  it('picks a font script per character and keeps spaces with the run before', () => {
    expect(scriptOf('A')).toBe('latin');
    expect(scriptOf('अ')).toBe('devanagari');
    expect(scriptOf('م')).toBe('arabic');
    expect(splitRuns('Priya प्रिया Sharma')).toEqual([
      { script: 'latin', text: 'Priya ' },
      { script: 'devanagari', text: 'प्रिया ' },
      { script: 'latin', text: 'Sharma' },
    ]);
  });
});
