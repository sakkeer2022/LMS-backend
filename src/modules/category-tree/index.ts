// Public surface of the category-tree module (ADR-0005, modular rule 2). Routers are
// mounted in src/routes/index.ts; other modules use only the functions below.
export { adminCategoryTreeRouter, learnerCategoryTreeRouter } from './category-tree.routes.js';
export { LEARNER_FLAG } from './category-tree.controller.js';
export { resolveBookableOffering, type BookableOffering } from './category-tree.offerings.js';
export { invalidateAdminTree } from './category-tree.reads.js';
