import type { Request, Response, NextFunction } from 'express';
import { successResponse } from '@core/response/index';
import { auditContextFrom } from '@middleware/audit.middleware';
import * as FacultyService from './faculty.service.js';
import * as FacultyList from './faculty.list.js';
import type { FacultyCountsQuery, InviteFacultyInput, ListFacultyQuery } from './faculty.dto.js';

// Query and body are validated by validateRequest in faculty.routes.ts

export async function listFaculty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await FacultyList.listFaculty(req.query as unknown as ListFacultyQuery);
    res.set('Cache-Control', 'no-store');
    res.json(successResponse(result.items, 'Faculty retrieved', result.meta));
  } catch (err) {
    next(err);
  }
}

export async function getStatusCounts(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const counts = await FacultyList.getFacultyStatusCounts(
      req.query as unknown as FacultyCountsQuery
    );
    res.set('Cache-Control', 'no-store');
    res.json(successResponse(counts, 'Faculty status counts retrieved'));
  } catch (err) {
    next(err);
  }
}

export async function inviteFaculty(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await FacultyService.inviteFaculty(
      req.body as InviteFacultyInput,
      auditContextFrom(req)
    );
    // The response can carry a single-use onboarding link
    res.set('Cache-Control', 'no-store');
    const sent = result.invitations.filter((i) => i.delivered).length;
    const message =
      result.inviteUrl !== null
        ? 'Invitation created'
        : sent === result.invitations.length
          ? `${sent} invitation${sent === 1 ? '' : 's'} sent`
          : `${sent} of ${result.invitations.length} invitations sent`;
    res.status(201).json(successResponse(result, message));
  } catch (err) {
    next(err);
  }
}
