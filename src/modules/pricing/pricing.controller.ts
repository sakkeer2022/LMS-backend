import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { errorResponse, successResponse } from '@core/response/index';
import {
  BulkUpdatePriceRulesDto,
  CreatePriceRuleDto,
  ListPriceRulesQueryDto,
  PriceIdParamsDto,
  QuotePricesDto,
  ResolvePriceQueryDto,
  UpdatePriceRuleDto,
} from './pricing.dto.js';
import * as Pricing from './pricing.service.js';
import { quoteSessionPrices, resolveSessionPrice } from './pricing.resolve.js';
import { listAwaitingPrices } from './pricing.awaiting.js';

const actorOf = (req: Request): Pricing.Actor => ({ userId: req.user?.sub ?? null });

function handler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export const listPriceRules = handler(async (req, res) => {
  const result = await Pricing.listPriceRules(ListPriceRulesQueryDto.parse(req.query));
  res.json(successResponse(result.items, 'Price rules retrieved', result.meta));
});

export const createPriceRule = handler(async (req, res) => {
  const rule = await Pricing.createPriceRule(CreatePriceRuleDto.parse(req.body), actorOf(req));
  res.status(201).json(successResponse(rule, 'Price rule created'));
});

export const updatePriceRule = handler(async (req, res) => {
  const { priceId } = PriceIdParamsDto.parse(req.params);
  const rule = await Pricing.updatePriceRule(
    priceId,
    UpdatePriceRuleDto.parse(req.body),
    actorOf(req)
  );
  res.json(successResponse(rule, 'Price rule updated'));
});

export const bulkUpdatePriceRules = handler(async (req, res) => {
  try {
    const rules = await Pricing.bulkUpdatePriceRules(
      BulkUpdatePriceRulesDto.parse(req.body),
      actorOf(req)
    );
    res.json(successResponse(rules, `${rules.length} price changes saved`));
  } catch (err) {
    // The global handler drops field errors for app errors; the rejected rows are the point here
    if (err instanceof Pricing.BulkUpdateError) {
      res.status(err.statusCode).json(errorResponse(err.message, err.fieldErrors, err.traceId));
      return;
    }
    throw err;
  }
});

export const resolvePrice = handler(async (req, res) => {
  res.json(successResponse(await resolveSessionPrice(ResolvePriceQueryDto.parse(req.query))));
});

export const quotePrices = handler(async (req, res) => {
  res.json(successResponse(await quoteSessionPrices(QuotePricesDto.parse(req.body))));
});

export const listAwaiting = handler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(
    successResponse(await listAwaitingPrices(), 'Subjects awaiting a tutor price retrieved')
  );
});
