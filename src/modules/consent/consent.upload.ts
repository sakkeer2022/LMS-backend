import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { config } from '@config/index';
import { BadRequestError, PayloadTooLargeError } from '@core/errors/index';

// A dedicated, small upload for the signature image only (not the general upload middleware)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.consent.signatureMaxBytes, files: 1, fields: 10, parts: 12 },
}).single('signature');

export function signatureUpload(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      return next(
        error.code === 'LIMIT_FILE_SIZE'
          ? new PayloadTooLargeError('The signature image is too large.')
          : new BadRequestError('The signing form could not be read.')
      );
    }
    next(error);
  });
}
