import { randomUUID } from 'node:crypto';
import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { config } from '@config/index';
import { ValidationError } from '@core/errors/index';
import { checkDocument } from '@modules/faculty/index';

/**
 * Library uploads: one file per resource in the `file` part, held in memory, then checked by
 * signature like the onboarding documents (PDF, JPG, PNG, DOC, DOCX, PPT, PPTX; size limit
 * UPLOAD_MAX_BYTES). Stored under a server-generated key in private storage.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxBytes, files: 1, fields: 10, fieldSize: 64 * 1024 },
}).single('file');

/** Multer errors become 422s on the `file` field, so the modal can show them inline. */
export function parseResourceUpload(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `The file is larger than ${Math.round(config.upload.maxBytes / 1048576)} MB`
          : err.code === 'LIMIT_FIELD_VALUE'
            ? 'The note is too long'
            : 'The upload could not be read';
      const field = err.code === 'LIMIT_FIELD_VALUE' ? (err.field ?? 'body') : 'file';
      return next(
        new ValidationError(message, {
          code: 'RESOURCE_INVALID',
          fieldErrors: { [field]: [message] },
        })
      );
    }
    next(err);
  });
}

export interface CheckedFile {
  buffer: Buffer;
  mime: string;
  size: number;
  fileName: string;
}

/** The uploaded file, checked; 422 on the `file` field when it is not acceptable. */
export async function checkResourceFile(file: Express.Multer.File): Promise<CheckedFile> {
  const check = await checkDocument(file);
  if (!check.ok) {
    throw new ValidationError(check.reason, {
      code: 'RESOURCE_INVALID',
      fieldErrors: { file: [check.reason] },
    });
  }
  return { buffer: file.buffer, mime: check.mime, size: check.size, fileName: check.fileName };
}

/** Server-generated storage key; never derived from the file name. */
export function libraryStorageKey(): string {
  return `library/${randomUUID()}`;
}
