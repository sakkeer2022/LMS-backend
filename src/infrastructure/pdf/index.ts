import type { PdfService } from './pdf.types.js';
import { PdfLibService } from './pdf-lib-service.js';

export type { ConsentStamp, PdfService } from './pdf.types.js';
export { isPng } from './pdf-lib-service.js';

let service: PdfService | undefined;

/** The PDF service. It has no external dependency, so tests use the real one. */
export function getPdfService(): PdfService {
  service ??= new PdfLibService();
  return service;
}
