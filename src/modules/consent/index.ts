// Public surface of the consent module.
export { adminConsentRouter, consentRouter, studentConsentRouter } from './consent.routes.js';
export {
  findConsentSummary,
  getConsentSummary,
  purgeExpiredConsents,
  signGuardianConsent,
  type ConsentReceipt,
  type ConsentSummary,
} from './consent.service.js';
