export interface ConsentStamp {
  /** The blank policy PDF being signed (the current Student Terms). */
  basePdf: Buffer;
  /** The drawn signature as PNG bytes, or the typed name when the signature was typed. One of the two. */
  signaturePng?: Buffer;
  typedName?: string;
  /** Printed as "Parent/guardian of <name>". */
  studentFullName: string;
  signedAt: Date;
  /** Client IP of the signing request. */
  ipAddress: string;
  /** Printed so the stamped page can be matched to the exact policy file (hex SHA-256 of `basePdf`). */
  policySha256: string;
}

/** PDF work behind one interface, so the library can change without touching the consent service. */
export interface TextDocument {
  title: string;
  paragraphs: string[];
}

export interface PdfService {
  /** A simple A4 document of a title and paragraphs (used for clearly marked development placeholders). */
  renderTextDocument(input: TextDocument): Promise<Buffer>;
  /** Number of pages of a readable, unencrypted PDF; throws for anything else. */
  inspect(bytes: Buffer): Promise<{ pageCount: number }>;

  /**
   * Appends a final "Guardian consent" page with the signature, the printed name, the UTC time and the
   * IP address, and returns the new PDF. The policy pages are not changed or overlaid.
   */
  stampConsent(input: ConsentStamp): Promise<Buffer>;
}
