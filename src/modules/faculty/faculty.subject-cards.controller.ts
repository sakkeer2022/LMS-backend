import type { Request, Response, NextFunction } from 'express';
import { successResponse } from '@core/response/index';
import { auditContextFrom } from '@middleware/audit.middleware';
import * as Cards from './faculty.subject-cards.js';
import type {
  RequestSubjectCardInput,
  ReviewSubjectCardInput,
} from './faculty.subject-cards.dto.js';

// Params and bodies are validated by validateRequest in the routes file

type Handler = (req: Request, res: Response) => Promise<void>;
const handle =
  (fn: Handler) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.set('Cache-Control', 'no-store');
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

const param = (req: Request, name: string): string => req.params[name] as string;
const userId = (req: Request): string => req.user?.sub as string;

export const listMine = handle(async (req, res) => {
  res.json(successResponse(await Cards.listMySubjectCards(userId(req)), 'Subject cards retrieved'));
});

export const request = handle(async (req, res) => {
  const { curriculumId } = req.body as RequestSubjectCardInput;
  const view = await Cards.requestSubjectCard(userId(req), curriculumId, auditContextFrom(req));
  res.status(201).json(successResponse(view, 'Subject card requested'));
});

export const cancel = handle(async (req, res) => {
  const view = await Cards.cancelSubjectCard(
    userId(req),
    param(req, 'cardId'),
    auditContextFrom(req)
  );
  res.json(successResponse(view, 'Subject card request cancelled'));
});

export const review = handle(async (req, res) => {
  const input = req.body as ReviewSubjectCardInput;
  const card = await Cards.reviewSubjectCard(
    param(req, 'facultyId'),
    param(req, 'cardId'),
    input,
    auditContextFrom(req)
  );
  res.json(
    successResponse(
      card,
      input.decision === 'approve' ? 'Subject card approved' : 'Subject card rejected'
    )
  );
});
