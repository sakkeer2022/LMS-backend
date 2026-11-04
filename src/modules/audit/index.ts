// Public surface of the audit module for other modules (modular rule 2).
export { auditRouter } from './audit.routes.js';
export { logAction, type LogActionParams } from './audit.service.js';
