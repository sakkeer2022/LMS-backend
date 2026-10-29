import { Prisma, type PriceRule } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type ErrorOptions,
} from '@core/errors/index';
import { getTraceId } from '@core/context/index';
import { logger } from '@core/logger/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import { toPrismaPagination } from '@shared/validation/index';
import { logAction } from '@modules/audit/index';
import { getOfferings, type OfferingSummary } from '@modules/catalogue/index';
import {
  DEFAULT_GST_RATE_BPS,
  computeStoredAmounts,
  toPriceAmounts,
  type PriceAmounts,
} from './pricing.engine.js';
import type {
  BulkUpdatePriceRulesInput,
  CreatePriceRuleInput,
  ListPriceRulesQuery,
  UpdatePriceRuleInput,
} from './pricing.dto.js';

/**
 * Admin price rules (LMS-58, ADR 0004): list, create, update and atomic bulk update.
 * Amounts are computed by the engine on every write; clients never send GST or totals.
 */

type Tx = Prisma.TransactionClient;

export interface Actor {
  userId: string | null;
}

export interface PriceRuleView {
  id: string;
  curriculumId: string;
  facultyId: string | null;
  facultyName: string | null;
  categoryName: string;
  boardName: string | null;
  subjectName: string;
  levelName: string;
  amounts: PriceAmounts;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
  revision: number;
  updatedAt: Date;
}

/** Bulk save failure listing the rejected rows, keyed changes[i] (screen 29b). */
export class BulkUpdateError extends ConflictError {
  constructor(
    public readonly fieldErrors: Record<string, string[]>,
    options?: ErrorOptions
  ) {
    super('No price changes were saved because some rows were rejected', {
      code: 'BULK_UPDATE_REJECTED',
      ...options,
    });
  }
}

function snapshot(rule: PriceRule): Record<string, unknown> {
  return {
    curriculumId: rule.curriculumId,
    facultyId: rule.facultyId,
    sessionPricePaise: rule.sessionPricePaise,
    gstRateBps: rule.gstRateBps,
    gstPaise: rule.gstPaise,
    studentPaysPaise: rule.studentPaysPaise,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    effectiveTo: rule.effectiveTo?.toISOString() ?? null,
    isActive: rule.isActive,
    revision: rule.revision,
  };
}

async function audit(
  actor: Actor,
  action: string,
  rule: PriceRule,
  previous: PriceRule | null
): Promise<void> {
  try {
    await logAction({
      traceId: getTraceId() ?? null,
      actorId: actor.userId,
      entity: 'price_rule',
      action,
      resourceId: rule.id,
      previousValue: previous ? snapshot(previous) : null,
      newValue: snapshot(rule),
    });
  } catch (err) {
    // The change is already committed; record the failure instead of failing the request
    logger.error({ err, action, priceRuleId: rule.id }, 'Failed to write pricing audit entry');
  }
}

async function toViews(rules: PriceRule[]): Promise<PriceRuleView[]> {
  const offerings = await getOfferings([...new Set(rules.map((r) => r.curriculumId))]);
  const facultyIds = [...new Set(rules.flatMap((r) => (r.facultyId ? [r.facultyId] : [])))];
  const faculty = await prisma.facultyProfile.findMany({
    where: { id: { in: facultyIds } },
    select: { id: true, user: { select: { fullName: true } } },
  });
  const facultyNames = new Map(faculty.map((f) => [f.id, f.user.fullName]));

  return rules.map((rule) => {
    const offering = offerings.get(rule.curriculumId) as OfferingSummary;
    return {
      id: rule.id,
      curriculumId: rule.curriculumId,
      facultyId: rule.facultyId,
      facultyName: rule.facultyId ? (facultyNames.get(rule.facultyId) ?? null) : null,
      categoryName: offering.categoryName,
      boardName: offering.boardName,
      subjectName: offering.subjectName,
      levelName: offering.levelName,
      amounts: toPriceAmounts(rule),
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      isActive: rule.isActive,
      revision: rule.revision,
      updatedAt: rule.updatedAt,
    };
  });
}

async function toView(rule: PriceRule): Promise<PriceRuleView> {
  const [view] = await toViews([rule]);
  return view;
}

export async function listPriceRules(
  query: ListPriceRulesQuery
): Promise<PaginatedResult<PriceRuleView>> {
  const contains = query.q ? { contains: query.q, mode: 'insensitive' as const } : undefined;
  const where: Prisma.PriceRuleWhereInput = {
    ...(query.facultyId ? { facultyId: query.facultyId } : {}),
    ...(query.defaultOnly ? { facultyId: null } : {}),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    curriculum: {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.boardId ? { boardId: query.boardId } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.levelId ? { levelId: query.levelId } : {}),
    },
    ...(contains
      ? {
          OR: [
            { faculty: { user: { fullName: contains } } },
            { curriculum: { subject: { name: contains } } },
            { curriculum: { board: { name: contains } } },
            { curriculum: { level: { name: contains } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.priceRule.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toPrismaPagination(query),
    }),
    prisma.priceRule.count({ where }),
  ]);
  return { items: await toViews(rows), meta: buildPaginationMeta(total, query.page, query.limit) };
}

/** Serialises writes for one curriculum, so the overlap check cannot race (no extension needed). */
async function lockCurriculum(tx: Tx, curriculumId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM curricula WHERE id = ${curriculumId}::uuid FOR UPDATE`;
  if (rows.length === 0)
    throw new ValidationError('Unknown curriculum', { code: 'UNKNOWN_CURRICULUM' });
}

/** Rejects a second active rule for the same curriculum and tutor with an overlapping window. */
async function assertNoOverlap(
  tx: Tx,
  rule: {
    curriculumId: string;
    facultyId: string | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  },
  excludeId?: string
): Promise<void> {
  const clash = await tx.priceRule.findFirst({
    where: {
      curriculumId: rule.curriculumId,
      facultyId: rule.facultyId,
      isActive: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      // Half-open windows overlap when each starts before the other ends
      ...(rule.effectiveTo ? { effectiveFrom: { lt: rule.effectiveTo } } : {}),
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: rule.effectiveFrom } }],
    },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError(
      rule.facultyId
        ? 'This tutor already has an active price for this offering in an overlapping period'
        : 'This offering already has an active default price in an overlapping period',
      { code: 'OVERLAPPING_RULE', context: { conflictingRuleId: clash.id } }
    );
  }
}

async function assertFacultyUsable(tx: Tx, facultyId: string): Promise<void> {
  const faculty = await tx.facultyProfile.findUnique({
    where: { id: facultyId },
    select: { isActive: true },
  });
  if (!faculty) throw new ValidationError('Unknown faculty profile', { code: 'UNKNOWN_FACULTY' });
  if (!faculty.isActive)
    throw new ValidationError('The faculty profile is not active', { code: 'INACTIVE_FACULTY' });
}

export async function createPriceRule(
  input: CreatePriceRuleInput,
  actor: Actor
): Promise<PriceRuleView> {
  const rule = await prisma.$transaction(async (tx) => {
    await lockCurriculum(tx, input.curriculumId);
    if (input.facultyId) await assertFacultyUsable(tx, input.facultyId);

    const effectiveFrom = input.effectiveFrom ?? new Date();
    const effectiveTo = input.effectiveTo ?? null;
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new ValidationError('effectiveTo must be after effectiveFrom', {
        code: 'INVALID_WINDOW',
      });
    }
    if (input.isActive) {
      await assertNoOverlap(tx, {
        curriculumId: input.curriculumId,
        facultyId: input.facultyId,
        effectiveFrom,
        effectiveTo,
      });
    }
    return tx.priceRule.create({
      data: {
        curriculumId: input.curriculumId,
        facultyId: input.facultyId,
        ...computeStoredAmounts(input.sessionPricePaise, DEFAULT_GST_RATE_BPS),
        effectiveFrom,
        effectiveTo,
        isActive: input.isActive,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
  });

  logger.info(
    { priceRuleId: rule.id, curriculumId: rule.curriculumId, actorId: actor.userId },
    'Price rule created'
  );
  await audit(actor, 'create', rule, null);
  return toView(rule);
}

/** Applies one change inside a transaction; throws a typed error when it cannot apply. */
async function applyUpdate(
  tx: Tx,
  id: string,
  input: Omit<UpdatePriceRuleInput, 'expectedRevision'> & { expectedRevision: number },
  actor: Actor
): Promise<{ before: PriceRule; after: PriceRule }> {
  const current = await tx.priceRule.findUnique({ where: { id } });
  if (!current) throw new NotFoundError('Price rule');
  await lockCurriculum(tx, current.curriculumId);

  const before = await tx.priceRule.findUniqueOrThrow({ where: { id } });
  if (before.revision !== input.expectedRevision) {
    throw new ConflictError('This price was changed by someone else; reload and try again', {
      code: 'STALE_REVISION',
      context: { currentRevision: before.revision },
    });
  }

  const effectiveFrom = input.effectiveFrom ?? before.effectiveFrom;
  const effectiveTo = input.effectiveTo === undefined ? before.effectiveTo : input.effectiveTo;
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    throw new ValidationError('effectiveTo must be after effectiveFrom', {
      code: 'INVALID_WINDOW',
    });
  }
  const isActive = input.isActive ?? before.isActive;
  if (isActive) {
    await assertNoOverlap(
      tx,
      {
        curriculumId: before.curriculumId,
        facultyId: before.facultyId,
        effectiveFrom,
        effectiveTo,
      },
      id
    );
  }

  const after = await tx.priceRule.update({
    where: { id },
    data: {
      // The rule keeps its stored GST rate; recalculation from the LMS-90 setting is a later job
      ...computeStoredAmounts(
        input.sessionPricePaise ?? before.sessionPricePaise,
        before.gstRateBps
      ),
      effectiveFrom,
      effectiveTo,
      isActive,
      revision: { increment: 1 },
      updatedById: actor.userId,
    },
  });
  return { before, after };
}

export async function updatePriceRule(
  id: string,
  input: UpdatePriceRuleInput,
  actor: Actor
): Promise<PriceRuleView> {
  const { before, after } = await prisma.$transaction((tx) => applyUpdate(tx, id, input, actor));
  logger.info({ priceRuleId: id, actorId: actor.userId }, 'Price rule updated');
  await audit(actor, after.isActive || !before.isActive ? 'update' : 'deactivate', after, before);
  return toView(after);
}

/** Screen 29b: every change or none. Rejected rows are reported as changes[i]. */
export async function bulkUpdatePriceRules(
  input: BulkUpdatePriceRulesInput,
  actor: Actor
): Promise<PriceRuleView[]> {
  const results = await prisma.$transaction(async (tx) => {
    const fieldErrors: Record<string, string[]> = {};
    const applied: { before: PriceRule; after: PriceRule }[] = [];
    for (const [i, change] of input.changes.entries()) {
      try {
        applied.push(await applyUpdate(tx, change.id, change, actor));
      } catch (err) {
        if (
          !(
            err instanceof ConflictError ||
            err instanceof NotFoundError ||
            err instanceof ValidationError
          )
        )
          throw err;
        fieldErrors[`changes[${i}]`] = [err.message];
      }
    }
    // Throwing rolls the whole transaction back
    if (Object.keys(fieldErrors).length > 0) throw new BulkUpdateError(fieldErrors);
    return applied;
  });

  logger.info({ count: results.length, actorId: actor.userId }, 'Price rules bulk updated');
  for (const { before, after } of results) await audit(actor, 'bulk_update', after, before);
  return toViews(results.map((r) => r.after));
}
