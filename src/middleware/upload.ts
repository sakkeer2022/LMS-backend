import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '@config/index';
import { logger } from '@core/logger/index';
import { BadRequestError } from '@core/errors/index';
import fs from 'fs';
import path from 'path';

export interface FileQuarantine {
  key: string;
  storagePath: string;
  originalName: string;
  mimetype: string;
  size: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      fileQuarantine?: FileQuarantine;
    }
  }
}

// Whitelist of allowed MIME types and their corresponding file-type extensions
const ALLOWED_MIME_TYPES = new Map<string, string[]>([
  ['image/jpeg', ['jpg', 'jpeg']],
  ['image/png', ['png']],
  ['image/webp', ['webp']],
  ['application/pdf', ['pdf']],
]);

// Set up multer in-memory storage with size limits
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: config.upload.maxBytes,
  },
});

export const singleUpload = upload.single('file');

/**
 * Express middleware to validate file MIME type, magic bytes (binary signature),
 * and quarantine the uploaded file to secure S3 storage (or isolated local folder fallback).
 */
export async function secureUploadPipeline(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const file = req.file;
  if (!file) {
    next(new BadRequestError('No file uploaded'));
    return;
  }

  // 1. Client MIME type check
  const allowedExtensions = ALLOWED_MIME_TYPES.get(file.mimetype);
  if (!allowedExtensions) {
    next(
      new BadRequestError(
        `Disallowed MIME type: ${file.mimetype}. Allowed types: ${Array.from(
          ALLOWED_MIME_TYPES.keys()
        ).join(', ')}`
      )
    );
    return;
  }

  // 2. Magic Byte signature check
  let detected;
  try {
    detected = await fileTypeFromBuffer(file.buffer);
  } catch (err) {
    logger.error({ err }, 'Failed to parse file signature magic bytes');
    next(new BadRequestError('Corrupted or invalid file signature'));
    return;
  }

  if (!detected) {
    next(new BadRequestError('Could not verify file type signature'));
    return;
  }

  // Assert signature matches allowed extensions
  const signatureMatches = allowedExtensions.includes(detected.ext);
  if (!signatureMatches || detected.mime !== file.mimetype) {
    logger.warn(
      {
        clientMimetype: file.mimetype,
        detectedMimetype: detected.mime,
        detectedExt: detected.ext,
      },
      '🚨 File type spoofing threat detected: file signature mismatch'
    );
    next(new BadRequestError('File signature does not match file extension/MIME type'));
    return;
  }

  // 3. Quarantine upload to secure storage
  const quarantineKey = `quarantine/${Date.now()}-${file.originalname}`;
  let storagePath = `s3://${config.aws.s3Bucket}/${quarantineKey}`;

  // Check if S3 environment variables are configured, otherwise fallback to local quarantine folder
  const hasS3Creds =
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    config.aws.s3Bucket &&
    config.aws.s3Bucket !== 'rbac-uploads-quarantine';

  if (hasS3Creds) {
    try {
      const s3 = new S3Client({
        region: config.aws.region,
      });

      await s3.send(
        new PutObjectCommand({
          Bucket: config.aws.s3Bucket,
          Key: quarantineKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          Metadata: {
            originalName: file.originalname,
            uploadedBy: req.user?.sub || 'system',
          },
        })
      );
      logger.info({ storagePath }, 'File successfully quarantined in S3');
    } catch (err) {
      logger.error({ err, storagePath }, 'Failed to upload quarantined file to S3');
      next(new Error('Secure upload quarantine failed'));
      return;
    }
  } else {
    // Fallback: Store file in isolated uploads/quarantine/ local directory (not served by express/public)
    try {
      const localDir = path.join(process.cwd(), 'uploads', 'quarantine');
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      const localFilePath = path.join(localDir, `${Date.now()}-${file.originalname}`);
      fs.writeFileSync(localFilePath, file.buffer);
      storagePath = `file://${localFilePath}`;
      logger.warn(
        { storagePath },
        '⚠️ AWS S3 not configured; quarantined file locally in process storage'
      );
    } catch (err) {
      logger.error({ err }, 'Failed to save quarantined file to local fallback storage');
      next(new Error('Secure upload quarantine failed'));
      return;
    }
  }

  // Attach target storage details to request so controller can access them
  req.fileQuarantine = {
    key: quarantineKey,
    storagePath,
    originalName: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
  };

  next();
}
