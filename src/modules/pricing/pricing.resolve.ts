import type { PriceRule } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { NotFoundError } from '@core/errors/index';
import {
  findOfferings,
  getOfferings,
  type CurriculumPriceProvider,
  type CurriculumUsageCheck,
  type OfferingSummary,
} from '@modules/catalogue/index';
import { priceRange, resolvePrice, toPriceAmounts, type PriceAmounts } from './pricing.engine.js';
import type { QuotePricesInput, ResolvePriceQuery } from './pricing.dto.js';

/**
 * Price resolution and quotes (LMS-58, ADR 0004). Booking (M05) will copy the
 * resolved amounts onto the booking; nothing here reserves or charges anything.
 */

export type ResolveResult =
  | {
      available: true;
      matchedRuleId: string;
      matchedOn: 'FACULTY' | 'DEFAULT';
      curriculumId: string;
      facultyId: string | null;
      amounts: PriceAmounts;
    }
  | { available: false; reason: 'PRICE_NOT_CONFIGURED' | 'INACTIVE_CATALOGUE' };

export type QuoteItemResult =
  | {
      index: number;
      available: true;
      min: PriceAmounts;
      max: PriceAmounts;
      curriculaMatched: number;
      curriculaPriced: number;
    }
  | { index: number; available: false; reason: 'PRICE_NOT_CONFIGURED' | 'NO_MATCHING_CURRICULUM' };

/** Loads the rules that could apply to these curricula for this tutor (or the default). */
async function candidateRules(
  curriculumIds: string[],
  facultyId: string | null | undefined
): Promise<PriceRule[]> {
  return prisma.priceRule.findMany({
    where: {
      curriculumId: { in: curriculumIds },
      isActive: true,
      OR: [{ facultyId: null }, ...(facultyId ? [{ facultyId }] : [])],
    },
  });
}

function resolveOne(
  rules: PriceRule[],
  offering: OfferingSummary,
  facultyId: string | null | undefined,
  at: Date
): ResolveResult {
  if (!offering.isActive) return { available: false, reason: 'INACTIVE_CATALOGUE' };
  const result = resolvePrice(rules, { curriculumId: offering.curriculumId, facultyId, at });
  if (!result.available) return result;
  return {
    available: true,
    matchedRuleId: result.rule.id,
    matchedOn: result.matchedOn,
    curriculumId: offering.curriculumId,
    facultyId: result.rule.facultyId,
    amounts: toPriceAmounts(result.rule),
  };
}

export async function resolveSessionPrice(query: ResolvePriceQuery): Promise<ResolveResult> {
  const offering = (await getOfferings([query.curriculumId])).get(query.curriculumId);
  if (!offering) throw new NotFoundError('Curriculum');
  if (query.facultyId) {
    const faculty = await prisma.facultyProfile.findUnique({
      where: { id: query.facultyId },
      select: { id: true },
    });
    if (!faculty) throw new NotFoundError('Faculty');
  }
  const rules = await candidateRules([offering.curriculumId], query.facultyId);
  return resolveOne(rules, offering, query.facultyId, query.at ?? new Date());
}

/**
 * Quotes several offerings at once (faculty registration, subjects and rates).
 * An item without a board can match several curricula; the result is then the
 * range over those that have a price (D6).
 */
export async function quoteSessionPrices(input: QuotePricesInput): Promise<QuoteItemResult[]> {
  const at = new Date();
  const results: QuoteItemResult[] = [];
  for (const [index, item] of input.items.entries()) {
    const offerings =
      'curriculumId' in item
        ? [...(await getOfferings([item.curriculumId])).values()]
        : await findOfferings({
            categoryId: item.categoryId,
            subjectId: item.subjectId,
            levelId: item.levelId,
            ...(item.boardId !== undefined ? { boardId: item.boardId } : {}),
          });
    const active = offerings.filter((o) => o.isActive);
    if (active.length === 0) {
      results.push({ index, available: false, reason: 'NO_MATCHING_CURRICULUM' });
      continue;
    }

    const rules = await candidateRules(
      active.map((o) => o.curriculumId),
      item.facultyId
    );
    const priced = active
      .map((o) => resolveOne(rules, o, item.facultyId, at))
      .flatMap((r) => (r.available ? [r.amounts] : []));
    const range = priceRange(priced);
    if (!range) {
      results.push({ index, available: false, reason: 'PRICE_NOT_CONFIGURED' });
      continue;
    }
    results.push({
      index,
      available: true,
      min: toPriceAmounts(range.min),
      max: toPriceAmounts(range.max),
      curriculaMatched: active.length,
      curriculaPriced: priced.length,
    });
  }
  return results;
}

// ── Hooks registered with the catalogue (see pricing/index.ts) ──────────────

/** Default (tutor-free) session price shown in the catalogue detail panel. */
export const defaultPriceForCurriculum: CurriculumPriceProvider = async (curriculumId) => {
  const rules = await candidateRules([curriculumId], null);
  const result = resolvePrice(rules, { curriculumId, facultyId: null, at: new Date() });
  return result.available ? result.rule.sessionPricePaise : null;
};

/** Curricula that have price rules, so the catalogue blocks moving them (D16). */
export const curriculaWithPrices: CurriculumUsageCheck = async (db, curriculumIds) => {
  const rows = await db.priceRule.findMany({
    where: { curriculumId: { in: curriculumIds } },
    select: { curriculumId: true },
    distinct: ['curriculumId'],
  });
  return rows.map((r) => r.curriculumId);
};
