// Public surface of the faculty module (LMS-39, LMS-78, LMS-79).
export { adminFacultyRouter } from './faculty.routes.js';
export { facultyOnboardingRouter, facultySelfRouter } from './faculty.onboarding.routes.js';
export {
  adminSubjectCardsRouter,
  facultySubjectCardsRouter,
} from './faculty.subject-cards.routes.js';
export {
  facultyIdOfUser,
  requireActiveSubjectCard,
  listMySubjectCards,
  type SubjectCardView,
} from './faculty.subject-cards.js';
export { MAX_SUBJECT_CARDS } from './faculty.subject-cards.rules.js';
export {
  checkDocument,
  isPreviewableMime,
  ALLOWED_DOCUMENT_MIME_TYPES,
} from './faculty.documents.js';
export {
  REQUIRED_VERIFICATION_DOCUMENTS,
  type FacultyListItem,
  type FacultyRowStatus,
  type VerificationStatus,
} from './faculty.list.js';
export { isValidEmail, EMAIL_PATTERN } from './faculty.dto.js';
export {
  assertFacultyCanSignIn,
  getFacultyAccess,
  onTutorPricesChanged,
  type FacultyAccessState,
} from './faculty.access.js';

// A tutor may sign in once approved and every subject is priced: re-check on each price change
import { registerTutorPriceListener } from '@modules/pricing/index';
import { onTutorPricesChanged as onPricesChanged } from './faculty.access.js';
registerTutorPriceListener(onPricesChanged);
