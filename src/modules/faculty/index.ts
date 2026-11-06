// Public surface of the faculty module (LMS-78, LMS-79).
export { adminFacultyRouter } from './faculty.routes.js';
export {
  REQUIRED_VERIFICATION_DOCUMENTS,
  type FacultyListItem,
  type FacultyRowStatus,
} from './faculty.list.js';
export { isValidEmail, EMAIL_PATTERN } from './faculty.dto.js';
