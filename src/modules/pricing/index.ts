// Public surface of the pricing module (modular rule 2). Routers are mounted in
// src/routes/index.ts.
import {
  registerCurriculumPriceProvider,
  registerCurriculumUsageCheck,
} from '@modules/catalogue/index';
import { curriculaWithPrices, defaultPriceForCurriculum } from './pricing.resolve.js';

// The catalogue shows the default price in its detail panel and blocks moving
// offerings that have prices (D16). Registered here to avoid a circular import.
registerCurriculumPriceProvider(defaultPriceForCurriculum);
registerCurriculumUsageCheck(curriculaWithPrices);

export { pricesRouter, adminPricesRouter } from './pricing.routes.js';
export { resolveSessionPrice, quoteSessionPrices, type ResolveResult } from './pricing.resolve.js';
export {
  CURRENCY,
  SESSION_MINUTES,
  computeStoredAmounts,
  toPriceAmounts,
  type PriceAmounts,
} from './pricing.engine.js';
