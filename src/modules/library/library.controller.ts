import type { Request, Response, NextFunction } from 'express';
import { successResponse } from '@core/response/index';
import { auditContextFrom } from '@middleware/audit.middleware';
import { isPreviewableMime } from '@modules/faculty/index';
import * as Faculty from './library.faculty.js';
import * as Admin from './library.admin.js';
import {
  ListResourcesQueryDto,
  ListSubmissionsQueryDto,
  ResourceFileQueryDto,
  SubmissionFileQueryDto,
  type CreateResourceInput,
  type ReviewSubmissionInput,
  type UpdateResourceInput,
} from './library.dto.js';

// Params and bodies are validated by validateRequest in the routes file; queries are parsed here

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

/** Stored files go out as attachments with a sandbox CSP; the apps preview PDF and images from the blob. */
function sendFile(
  res: Response,
  file: { body: Buffer; contentType: string; fileName: string }
): void {
  res.set({
    'Content-Type': file.contentType,
    'Content-Length': String(file.body.length),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'X-Document-Previewable': isPreviewableMime(file.contentType) ? 'true' : 'false',
  });
  res.end(file.body);
}

// ── Faculty ──

export const overview = handle(async (req, res) => {
  res.json(successResponse(await Faculty.getLibraryOverview(userId(req)), 'Library retrieved'));
});

export const listResources = handle(async (req, res) => {
  const { curriculumId } = ListResourcesQueryDto.parse(req.query);
  res.json(
    successResponse(await Faculty.listResources(userId(req), curriculumId), 'Resources retrieved')
  );
});

export const createResource = handle(async (req, res) => {
  const view = await Faculty.createResource(
    userId(req),
    req.body as CreateResourceInput,
    req.file,
    auditContextFrom(req)
  );
  res.status(201).json(successResponse(view, 'Resource submitted for review'));
});

export const updateResource = handle(async (req, res) => {
  const view = await Faculty.updateResource(
    userId(req),
    param(req, 'resourceId'),
    req.body as UpdateResourceInput,
    req.file,
    auditContextFrom(req)
  );
  res.json(successResponse(view, 'Changes submitted for review'));
});

export const withdrawResource = handle(async (req, res) => {
  await Faculty.withdrawResource(userId(req), param(req, 'resourceId'), auditContextFrom(req));
  res.json(successResponse(null, 'Resource withdrawn'));
});

export const resourceFile = handle(async (req, res) => {
  const { version } = ResourceFileQueryDto.parse(req.query);
  sendFile(res, await Faculty.getOwnResourceFile(userId(req), param(req, 'resourceId'), version));
});

// ── Admin ──

export const listSubmissions = handle(async (req, res) => {
  const result = await Admin.listSubmissions(ListSubmissionsQueryDto.parse(req.query));
  res.json(successResponse(result.items, 'Submissions retrieved', result.meta));
});

export const submissionCounts = handle(async (req, res) => {
  const query = ListSubmissionsQueryDto.parse(req.query);
  res.json(successResponse(await Admin.submissionCounts(query), 'Counts retrieved'));
});

export const getSubmission = handle(async (req, res) => {
  res.json(
    successResponse(await Admin.getSubmission(param(req, 'submissionId')), 'Submission retrieved')
  );
});

export const reviewSubmission = handle(async (req, res) => {
  const input = req.body as ReviewSubmissionInput;
  const detail = await Admin.reviewSubmission(
    param(req, 'submissionId'),
    input,
    auditContextFrom(req)
  );
  res.json(
    successResponse(detail, input.status === 'approved' ? 'Resource approved' : 'Resource rejected')
  );
});

export const submissionFile = handle(async (req, res) => {
  const { version } = SubmissionFileQueryDto.parse(req.query);
  sendFile(
    res,
    await Admin.getSubmissionFile(param(req, 'submissionId'), version, auditContextFrom(req))
  );
});
