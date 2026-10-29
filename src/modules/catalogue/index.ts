// Public surface of the catalogue module (modular rule 2). Other modules use
// only these exports; routers are mounted in src/routes/index.ts.
export { catalogueRouter, adminCatalogueRouter } from './catalogue.routes.js';
export {
  assertBookableCurriculum,
  findOfferings,
  getAncestors,
  getOfferings,
  registerCurriculumPriceProvider,
  registerCurriculumUsageCheck,
  type CurriculumPriceProvider,
  type CurriculumUsageCheck,
  type OfferingSummary,
} from './catalogue.service.js';
