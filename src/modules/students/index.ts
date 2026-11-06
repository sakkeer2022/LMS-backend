// Public surface of the students module (the admin's view of student records).
export { adminStudentsRouter } from './students.routes.js';
export {
  getStudent,
  listStudents,
  type StudentDetailView,
  type StudentView,
} from './students.service.js';
