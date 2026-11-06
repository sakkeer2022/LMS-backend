import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '@config/index';

/**
 * Verification documents (screen 43d): Photo ID, highest degree certificate and PAN card.
 * Types are decided by the file's signature (magic bytes), never by the client's MIME type
 * or name alone. Allowed (decided 2026-11-04): PDF, JPG, PNG, DOC, DOCX, PPT, PPTX.
 * Word and PowerPoint files are download-only for admins (no inline preview).
 */

export const ONBOARDING_DOCUMENTS = [
  { field: 'photoId', type: 'GOVERNMENT_ID', label: 'Photo ID' },
  { field: 'degreeCertificate', type: 'DEGREE_CERTIFICATE', label: 'Highest degree certificate' },
  { field: 'panCard', type: 'PAN_CARD', label: 'PAN card' },
] as const;

export type OnboardingDocumentField = (typeof ONBOARDING_DOCUMENTS)[number]['field'];

interface AllowedType {
  mime: string;
  /** File-name extensions that may carry this signature. */
  extensions: readonly string[];
  /** Safe to show inline in the admin drawer. */
  previewable: boolean;
}

/** Signature (file-type `ext`) → allowed document types. OLE files ("cfb") are told apart by extension. */
const BY_SIGNATURE: Record<string, readonly AllowedType[]> = {
  pdf: [{ mime: 'application/pdf', extensions: ['pdf'], previewable: true }],
  jpg: [{ mime: 'image/jpeg', extensions: ['jpg', 'jpeg'], previewable: true }],
  png: [{ mime: 'image/png', extensions: ['png'], previewable: true }],
  docx: [
    {
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extensions: ['docx'],
      previewable: false,
    },
  ],
  pptx: [
    {
      mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      extensions: ['pptx'],
      previewable: false,
    },
  ],
  cfb: [
    { mime: 'application/msword', extensions: ['doc'], previewable: false },
    { mime: 'application/vnd.ms-powerpoint', extensions: ['ppt'], previewable: false },
  ],
};

export const ALLOWED_DOCUMENT_MIME_TYPES = Object.values(BY_SIGNATURE)
  .flat()
  .map((t) => t.mime);

export function isPreviewableMime(mime: string): boolean {
  return Object.values(BY_SIGNATURE)
    .flat()
    .some((t) => t.mime === mime && t.previewable);
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** A display-safe file name: no path, no control characters, at most 255 characters. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'document';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|]/g, '').trim();
  return (cleaned || 'document').slice(-255);
}

export type DocumentCheck =
  | { ok: true; mime: string; size: number; fileName: string }
  | { ok: false; reason: string };

/** Checks one uploaded file: size, signature and a matching extension. */
export async function checkDocument(file: {
  buffer: Buffer;
  originalname: string;
  size: number;
}): Promise<DocumentCheck> {
  if (file.size === 0) return { ok: false, reason: 'The file is empty' };
  if (file.size > config.upload.maxBytes) {
    return {
      ok: false,
      reason: `The file is larger than ${Math.round(config.upload.maxBytes / 1048576)} MB`,
    };
  }
  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    detected = await fileTypeFromBuffer(file.buffer);
  } catch {
    detected = undefined;
  }
  const extension = extensionOf(file.originalname);
  const candidates = detected ? (BY_SIGNATURE[detected.ext] ?? []) : [];
  const match = candidates.find((t) => t.extensions.includes(extension));
  if (!match) {
    return { ok: false, reason: 'Upload a PDF, DOC, DOCX, PPT, PPTX, JPG or PNG file' };
  }
  return { ok: true, mime: match.mime, size: file.size, fileName: safeFileName(file.originalname) };
}

/** Server-generated storage key; never derived from the file name. */
export function documentStorageKey(): string {
  return `faculty-documents/${randomUUID()}`;
}
