import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import {
  computeStoredAmounts,
  isEffectiveAt,
  priceRange,
  resolvePrice,
  toPriceAmounts,
  windowsOverlap,
  type ResolvableRule,
} from '../../src/modules/pricing/pricing.engine';

const d = (iso: string) => new Date(iso);

describe('computeStoredAmounts (GST round half up)', () => {
  it.each([
    // price paise, rate bps, gst paise, student pays
    [145000, 1800, 26100, 171100], // ₹1,450 → GST ₹261 → ₹1,711 (screen 29)
    [160000, 1800, 28800, 188800],
    [99999, 1800, 18000, 117999], // 17999.82 rounds up
    [100003, 1800, 18001, 118004], // 18000.54 rounds up
    [100000 + 2, 1800, 18000, 118002], // 18000.36 rounds down
    [25, 1800, 5, 30], // 4.5 rounds half up to 5
    [1, 1800, 0, 1],
    [50000, 0, 0, 50000],
    [100000000, 10000, 100000000, 200000000],
  ])('%i paise at %i bps -> GST %i, pays %i', (price, rate, gst, pays) => {
    expect(computeStoredAmounts(price, rate)).toEqual({
      sessionPricePaise: price,
      gstRateBps: rate,
      gstPaise: gst,
      studentPaysPaise: pays,
    });
  });

  it.each([[0], [-1], [1.5], [Number.NaN]])('rejects price %s', (price) => {
    expect(() => computeStoredAmounts(price, 1800)).toThrow(RangeError);
  });

  it.each([[-1], [10001], [18.5]])('rejects rate %s', (rate) => {
    expect(() => computeStoredAmounts(1000, rate)).toThrow(RangeError);
  });
});

describe('toPriceAmounts (CGST/SGST display split)', () => {
  it.each([
    [26100, 13050, 13050],
    [5, 3, 2], // CGST takes the odd paisa
    [0, 0, 0],
  ])('GST %i -> CGST %i + SGST %i', (gst, cgst, sgst) => {
    const amounts = toPriceAmounts({
      sessionPricePaise: 1,
      gstRateBps: 1800,
      gstPaise: gst,
      studentPaysPaise: 1 + gst,
    });
    expect([amounts.cgstPaise, amounts.sgstPaise]).toEqual([cgst, sgst]);
    expect(amounts.cgstPaise + amounts.sgstPaise).toBe(gst);
    expect(amounts.currency).toBe('INR');
    expect(amounts.durationMinutes).toBe(60);
  });

  it('returns only amount fields when given a whole price rule row', () => {
    const row = {
      id: 'rule-1',
      curriculumId: 'c-1',
      createdById: 'u-1',
      ...computeStoredAmounts(100000, 1800),
    };
    expect(Object.keys(toPriceAmounts(row)).sort()).toEqual([
      'cgstPaise',
      'currency',
      'durationMinutes',
      'gstPaise',
      'gstRateBps',
      'sessionPricePaise',
      'sgstPaise',
      'studentPaysPaise',
    ]);
  });
});

describe('effective windows', () => {
  const jan = { effectiveFrom: d('2026-01-01'), effectiveTo: d('2026-02-01') };
  it.each([
    [{ effectiveFrom: d('2026-01-15'), effectiveTo: null }, true],
    [{ effectiveFrom: d('2026-02-01'), effectiveTo: null }, false], // end is exclusive
    [{ effectiveFrom: d('2025-12-01'), effectiveTo: d('2026-01-01') }, false],
    [{ effectiveFrom: d('2025-12-01'), effectiveTo: d('2026-01-02') }, true],
    [{ effectiveFrom: d('2025-01-01'), effectiveTo: null }, true],
  ])('overlap with January: %o -> %s', (other, expected) => {
    expect(windowsOverlap(jan, other)).toBe(expected);
    expect(windowsOverlap(other, jan)).toBe(expected);
  });

  it('treats the start as inclusive and the end as exclusive', () => {
    expect(isEffectiveAt(jan, d('2026-01-01'))).toBe(true);
    expect(isEffectiveAt(jan, d('2026-02-01'))).toBe(false);
    expect(
      isEffectiveAt({ effectiveFrom: d('2026-01-01'), effectiveTo: null }, d('2030-01-01'))
    ).toBe(true);
  });
});

describe('resolvePrice', () => {
  const base = {
    curriculumId: 'cur',
    isActive: true,
    effectiveFrom: d('2026-01-01'),
    effectiveTo: null,
  };
  const amounts = (price: number) => computeStoredAmounts(price, 1800);
  const rule = (id: string, over: Partial<ResolvableRule> = {}): ResolvableRule => ({
    id,
    facultyId: null,
    ...base,
    ...amounts(100000),
    ...over,
  });
  const at = d('2026-06-01');

  const rules: ResolvableRule[] = [
    rule('default', { ...amounts(140000) }),
    rule('anil', { facultyId: 'anil', ...amounts(160000) }),
    rule('anil-old', {
      facultyId: 'anil',
      effectiveFrom: d('2025-01-01'),
      effectiveTo: d('2026-01-01'),
    }),
    rule('meera-inactive', { facultyId: 'meera', isActive: false }),
    rule('other-curriculum', { curriculumId: 'other', facultyId: 'ravi' }),
  ];

  it.each([
    // step, facultyId, expected rule, matchedOn
    ['1: tutor rule on this curriculum', 'anil', 'anil', 'FACULTY'],
    ['2: default when the tutor has no rule', 'ravi', 'default', 'DEFAULT'],
    ['2: default when the tutor rule is inactive', 'meera', 'default', 'DEFAULT'],
    ['2: default when no tutor is given', null, 'default', 'DEFAULT'],
  ] as const)('step %s', (_step, facultyId, expectedId, matchedOn) => {
    const result = resolvePrice(rules, { curriculumId: 'cur', facultyId, at });
    expect(result).toMatchObject({ available: true, matchedOn, rule: { id: expectedId } });
  });

  it('uses the rule that was effective at the given time', () => {
    const result = resolvePrice(rules, {
      curriculumId: 'cur',
      facultyId: 'anil',
      at: d('2025-06-01'),
    });
    expect(result).toMatchObject({
      available: true,
      matchedOn: 'FACULTY',
      rule: { id: 'anil-old' },
    });
  });

  it('step 3: PRICE_NOT_CONFIGURED, never a zero price', () => {
    expect(resolvePrice(rules, { curriculumId: 'missing', facultyId: 'anil', at })).toEqual({
      available: false,
      reason: 'PRICE_NOT_CONFIGURED',
    });
    // Only an inactive tutor rule and no default
    expect(resolvePrice([rules[3]], { curriculumId: 'cur', facultyId: 'meera', at })).toEqual({
      available: false,
      reason: 'PRICE_NOT_CONFIGURED',
    });
  });

  it('never matches another tutor’s rule', () => {
    const onlyAnil = [rules[1]];
    expect(resolvePrice(onlyAnil, { curriculumId: 'cur', facultyId: 'ravi', at }).available).toBe(
      false
    );
  });
});

describe('priceRange', () => {
  it('returns the cheapest and dearest prices', () => {
    const range = priceRange([
      computeStoredAmounts(160000, 1800),
      computeStoredAmounts(145000, 1800),
    ]);
    expect(range?.min.sessionPricePaise).toBe(145000);
    expect(range?.max.sessionPricePaise).toBe(160000);
    expect(priceRange([])).toBeNull();
  });
});

describe('no package, bundle or credit logic (LMS-40 acceptance criterion)', () => {
  const forbidden = /\b(package|bundle|credits?)\b/i;

  it('has no such fields in the PriceRule model', () => {
    const schema = readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf-8');
    const model = schema.slice(
      schema.indexOf('model PriceRule {'),
      schema.indexOf('}', schema.indexOf('model PriceRule {'))
    );
    expect(model).not.toMatch(forbidden);
  });

  it('has no such code in the pricing module', () => {
    const dir = path.resolve(__dirname, '../../src/modules/pricing');
    for (const file of readdirSync(dir)) {
      const source = readFileSync(path.join(dir, file), 'utf-8')
        // The module's own statement that this logic does not exist is allowed
        .replace(/No package, bundle or credit[^\n]*/gi, '');
      expect(source, file).not.toMatch(forbidden);
    }
  });
});
