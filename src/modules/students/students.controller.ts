import type { NextFunction, Request, Response } from 'express';
import { successResponse } from '@core/response/index';
import * as StudentsService from './students.service.js';
import type { ListStudentsQuery } from './students.dto.js';

// Query and params are validated by validateRequest in students.routes.ts

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await StudentsService.listStudents(req.query as unknown as ListStudentsQuery);
    // The list holds dates of birth and guardian contacts: never cached
    res.set('Cache-Control', 'private, no-store');
    res.json(successResponse(result.items, 'Students retrieved', result.meta));
  } catch (err) {
    next(err);
  }
}

export async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const student = await StudentsService.getStudent(req.params['studentId'] as string);
    res.set('Cache-Control', 'private, no-store');
    res.json(successResponse(student, 'Student retrieved'));
  } catch (err) {
    next(err);
  }
}
