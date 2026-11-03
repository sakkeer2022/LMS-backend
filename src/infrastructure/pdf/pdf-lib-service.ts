// @pdf-lib/fontkit needs regeneratorRuntime for Devanagari shaping; without it any Devanagari name throws.
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import type { ConsentStamp, PdfService } from './pdf.types.js';
import { loadFont, splitRuns, type Script } from './fonts.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const isPng = (bytes: Buffer): boolean =>
  bytes.length > 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);

const MARGIN = 56;
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.28, 0.33, 0.41);

export class PdfLibService implements PdfService {
  async stampConsent(input: ConsentStamp): Promise<Buffer> {
    const doc = await PDFDocument.load(input.basePdf, { ignoreEncryption: false });
    doc.registerFontkit(fontkit);
    try {
      doc.getForm().flatten();
    } catch {
      // A PDF without a form has nothing to flatten
    }

    const fonts = new Map<Script, PDFFont>();
    const fontFor = async (script: Script): Promise<PDFFont> => {
      let font = fonts.get(script);
      if (!font) {
        font = await doc.embedFont(await loadFont(script), { subset: true });
        fonts.set(script, font);
      }
      return font;
    };

    const last = doc.getPage(doc.getPageCount() - 1);
    const { width, height } = last.getSize();
    const page = doc.addPage([width, height]);
    let y = height - MARGIN;

    const drawLine = async (text: string, size: number, color = INK): Promise<void> => {
      let x = MARGIN;
      for (const run of splitRuns(text)) {
        const font = await fontFor(run.script);
        page.drawText(run.text, { x, y, size, font, color });
        x += font.widthOfTextAtSize(run.text, size);
      }
      y -= size * 1.5;
    };
    const drawWrapped = async (text: string, size: number, color = INK): Promise<void> => {
      const max = width - MARGIN * 2;
      let line = '';
      for (const word of text.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if ((await this.measure(candidate, size, fontFor)) > max && line) {
          await drawLine(line, size, color);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) await drawLine(line, size, color);
    };

    await drawLine('Parent/guardian consent', 20);
    y -= 6;
    await drawLine('Student Terms', 11, MUTED);
    y -= 14;
    await drawWrapped(`Parent/guardian of ${input.studentFullName}`, 14);
    y -= 8;
    await drawLine(`Signed (UTC): ${formatUtc(input.signedAt)}`, 11);
    await drawLine(`IP address: ${input.ipAddress}`, 11);
    await drawLine(`Policy document SHA-256: ${input.policySha256.slice(0, 32)}`, 8, MUTED);
    await drawLine(`${input.policySha256.slice(32)}`, 8, MUTED);
    y -= 10;
    await drawLine('Signature', 11, MUTED);
    if (input.signaturePng) {
      await this.drawSignature(doc, page, input.signaturePng, y);
    } else if (input.typedName) {
      await drawWrapped(input.typedName, 16);
    } else {
      throw new Error('A consent needs a drawn or a typed signature');
    }

    return Buffer.from(await doc.save());
  }

  private async measure(
    text: string,
    size: number,
    fontFor: (script: Script) => Promise<PDFFont>
  ): Promise<number> {
    let total = 0;
    for (const run of splitRuns(text))
      total += (await fontFor(run.script)).widthOfTextAtSize(run.text, size);
    return total;
  }

  private async drawSignature(
    doc: PDFDocument,
    page: PDFPage,
    png: Buffer,
    top: number
  ): Promise<void> {
    const image = await doc.embedPng(png);
    const maxWidth = 280;
    const maxHeight = 110;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const drawnWidth = image.width * scale;
    const drawnHeight = image.height * scale;
    page.drawImage(image, {
      x: MARGIN,
      y: top - drawnHeight,
      width: drawnWidth,
      height: drawnHeight,
    });
    const ruleY = top - drawnHeight - 6;
    page.drawLine({
      start: { x: MARGIN, y: ruleY },
      end: { x: MARGIN + maxWidth, y: ruleY },
      thickness: 0.75,
      color: MUTED,
    });
  }
}

const pad = (value: number): string => value.toString().padStart(2, '0');
const formatUtc = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
  `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
