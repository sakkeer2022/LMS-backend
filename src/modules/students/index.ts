// Public surface of the students module (the admin's view of student records).
export { adminStudentsRouter, studentSelfRouter } from './students.routes.js';
export {
  getOwnProfile,
  getStudent,
  listStudents,
  type OwnProfileView,
  type StudentDetailView,
  type StudentView,
} from './students.service.js';
