import { z } from 'zod';

// Multer handles the binary file; this endpoint accepts no metadata fields.
export const UploadBodyDto = z.object({}).strict();
