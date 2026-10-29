/**
 * Pure pricing rules (LMS-58, ADR 0004). No database access; every rule here is
 * covered by table-driven tests in tests/unit/pricing-engine.test.ts.
 * No package, bundle or credit logic exists anywhere in pricing.
 */

export const CURRENCY = 'INR';
export const SESSION_MINUTES = 60;
/** 18% GST until the GST setting (LMS-90) is connected. */
export const DEFAULT_GST_RATE_BPS = 1800;

export interface StoredAmounts {
  sessionPricePaise: number;
  gstRateBps: number;
  gstPaise: number;
  studentPaysPaise: number;
}

export interface PriceAmounts extends StoredAmounts {
  currency: typeof CURRENCY;
  durationMinutes: typeof SESSION_MINUTES;
  cgstPaise: number;
  sgstPaise: number;
}

/**
 * The only place amounts are calculated. GST = round_half_up(price x rate / 10000),
 * in integer arithmetic so no floating-point rounding is involved. The migration's
 * CHECK constraint enforces the same formula.
 */
export function computeStoredAmounts(sessionPricePaise: number, gstRateBps: number): StoredAmounts {
  if (!Number.isSafeInteger(sessionPricePaise) || sessionPricePaise <= 0) {
    throw new RangeError('sessionPricePaise must be a positive integer');
  }
  if (!Number.isInteger(gstRateBps) || gstRateBps < 0 || gstRateBps > 10000) {
    throw new RangeError('gstRateBps must be an integer between 0 and 10000');
  }
  const gstPaise = Math.floor((sessionPricePaise * gstRateBps + 5000) / 10000);
  return {
    sessionPricePaise,
    gstRateBps,
    gstPaise,
    studentPaysPaise: sessionPricePaise + gstPaise,
  };
}

/**
 * Adds the display-only CGST/SGST split (intra-state; IGST is decision D15).
 * CGST takes the odd paisa so the two halves always add up to the GST.
 */
export function toPriceAmounts(stored: StoredAmounts): PriceAmounts {
  const cgstPaise = Math.ceil(stored.gstPaise / 2);
  return {
    currency: CURRENCY,
    durationMinutes: SESSION_MINUTES,
    ...stored,
    cgstPaise,
    sgstPaise: stored.gstPaise - cgstPaise,
  };
}

export interface RuleWindow {
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** Half-open windows [from, to) overlap when each starts before the other ends. */
export function windowsOverlap(a: RuleWindow, b: RuleWindow): boolean {
  const aEnds = a.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnds = b.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return a.effectiveFrom.getTime() < bEnds && b.effectiveFrom.getTime() < aEnds;
}

export function isEffectiveAt(rule: RuleWindow, at: Date): boolean {
  return (
    rule.effectiveFrom.getTime() <= at.getTime() &&
    (rule.effectiveTo === null || at.getTime() < rule.effectiveTo.getTime())
  );
}

export interface ResolvableRule extends RuleWindow, StoredAmounts {
  id: string;
  curriculumId: string;
  facultyId: string | null;
  isActive: boolean;
}

export type Resolution<R extends ResolvableRule> =
  | { available: true; matchedOn: 'FACULTY' | 'DEFAULT'; rule: R }
  | { available: false; reason: 'PRICE_NOT_CONFIGURED' };

/**
 * Resolution order (D-E):
 * 1. the active rule for this tutor and this curriculum, effective at `at`;
 * 2. otherwise the curriculum's default rule (no tutor);
 * 3. otherwise PRICE_NOT_CONFIGURED. Never a zero price, and no broader
 *    category or board defaults.
 * Overlaps are rejected on write, so at most one rule can match per step; the
 * newest window is preferred defensively.
 */
export function resolvePrice<R extends ResolvableRule>(
  rules: readonly R[],
  query: { curriculumId: string; facultyId?: string | null; at: Date }
): Resolution<R> {
  const candidates = rules
    .filter(
      (r) => r.curriculumId === query.curriculumId && r.isActive && isEffectiveAt(r, query.at)
    )
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());

  if (query.facultyId) {
    const tutorRule = candidates.find((r) => r.facultyId === query.facultyId);
    if (tutorRule) return { available: true, matchedOn: 'FACULTY', rule: tutorRule };
  }
  const defaultRule = candidates.find((r) => r.facultyId === null);
  if (defaultRule) return { available: true, matchedOn: 'DEFAULT', rule: defaultRule };
  return { available: false, reason: 'PRICE_NOT_CONFIGURED' };
}

/** Lowest and highest amounts among resolved prices (quote ranges across boards, D6). */
export function priceRange(
  amounts: readonly StoredAmounts[]
): { min: StoredAmounts; max: StoredAmounts } | null {
  if (amounts.length === 0) return null;
  const sorted = [...amounts].sort((a, b) => a.studentPaysPaise - b.studentPaysPaise);
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}
