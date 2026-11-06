import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import { validateRequest } from '@middleware/validate';
import * as StudentsController from './students.controller.js';
import { ListStudentsQueryDto, StudentParamsDto } from './students.dto.js';

/** The admin's view of student records. */
export const adminStudentsRouter = Router();

adminStudentsRouter.use(authenticate, requirePermission('student.read'));

/**
 * @openapi
 * /admin/students:
 *   get:
 *     summary: List students with their consent status
 *     description: Newest first. A student is a minor when below the guardian consent age of their country (read from the country table). Each item carries the guardian contact and the consent status. Requires student.read. Private, no-store.
 *     tags: [Consent]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - { in: query, name: q, schema: { type: string, maxLength: 100 } }
 *       - { in: query, name: country, schema: { type: string, minLength: 2, maxLength: 2 } }
 *       - { in: query, name: minor, schema: { type: boolean } }
 *       - { in: query, name: consent, schema: { type: string, enum: [signed, missing, not_required] } }
 *     responses:
 *       200:
 *         description: A page of students
 *       401:
 *         description: Not signed in
 *       403:
 *         description: Requires student.read
 *       422:
 *         description: Invalid filter
 */
adminStudentsRouter.get(
  '/',
  validateRequest({ query: ListStudentsQueryDto }),
  StudentsController.list
);

/**
 * @openapi
 * /admin/students/{studentId}:
 *   get:
 *     summary: Show one student
 *     description: The student, the learning profile names, the guardian contact and, for a minor with a signed consent, the consent record. studentId is the student profile id. Requires student.read.
 *     tags: [Consent]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: The student
 *       403:
 *         description: Requires student.read
 *       404:
 *         description: Unknown student
 */
adminStudentsRouter.get(
  '/:studentId',
  validateRequest({ params: StudentParamsDto }),
  StudentsController.show
);
