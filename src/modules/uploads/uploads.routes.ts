import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import { singleUpload, secureUploadPipeline } from '@middleware/upload.js';
import { UploadBodyDto } from './uploads.dto.js';
import { uploadFile } from './uploads.controller.js';

export const uploadsRouter = Router();

/**
 * @openapi
 * /uploads:
 *   post:
 *     summary: Quarantine a file and enqueue the existing scan workflow
 *     description: Requires uploads.create and signed CSRF cookie plus x-csrf-token. Acceptance is not scan completion. No public download is created.
 *     tags: [Uploads]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: header
 *         name: x-csrf-token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             additionalProperties: false
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       202:
 *         description: File quarantined and scan job queued; not approved or public
 *       400:
 *         description: Missing file or disallowed/mismatched signature or MIME type
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Missing uploads.create permission or invalid CSRF token
 *       422:
 *         description: Unexpected metadata field
 *       500:
 *         description: Storage or queue operation failed
 */
uploadsRouter.post(
  '/',
  authenticate,
  requirePermission('uploads.create'),
  singleUpload,
  (req, _res, next) => {
    try {
      UploadBodyDto.parse(req.body ?? {});
      next();
    } catch (error) {
      next(error);
    }
  },
  secureUploadPipeline,
  uploadFile
);
