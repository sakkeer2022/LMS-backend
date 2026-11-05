import { PDFDocument } from 'pdf-lib';

/** A one-pixel transparent PNG, enough to stand in for a drawn signature. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/** A signature-like PNG: a diagonal stroke on a transparent canvas, so it is visible when rendered. */
export async function strokePng(): Promise<Buffer> {
  const { deflateSync } = await import('node:zlib');
  const width = 120;
  const height = 40;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    const x = Math.floor((y / height) * (width - 4));
    for (let dx = 0; dx < 3; dx++) {
      const i = y * (width * 4 + 1) + 1 + (x + dx) * 4;
      raw[i] = 20;
      raw[i + 1] = 20;
      raw[i + 2] = 90;
      raw[i + 3] = 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A real PDF with the given number of text pages, standing in for a Student Terms document. */
export async function blankPolicyPdf(pages = 2, label = 'Student Terms'): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`${label} - page ${i}`, { x: 56, y: 780, size: 16 });
  }
  return Buffer.from(await doc.save());
}
