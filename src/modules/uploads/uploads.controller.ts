import { Request, Response, NextFunction } from 'express';
import { BadRequestError, UnauthorizedError } from '@core/errors/index';
import { successResponse } from '@core/response/index';
import { UploadBodyDto } from './uploads.dto.js';
import { enqueueQuarantinedUpload } from './uploads.service.js';

export async function uploadFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    UploadBodyDto.parse(req.body ?? {});
    if (!req.user) throw new UnauthorizedError();
    if (!req.fileQuarantine) throw new BadRequestError('No quarantined file available');
    const result = await enqueueQuarantinedUpload(req.fileQuarantine, req.user.sub);
    res.status(202).json(successResponse(result, 'Upload quarantined for scanning'));
  } catch (error) {
    next(error);
  }
}
