export interface StoredFile {
  /** The key the file was stored under (the only thing the database keeps) */
  key: string;
  /** SHA-256 of the stored bytes, hex */
  sha256: string;
  size: number;
}

/**
 * Where signed consents and policy PDFs live. Services depend on this interface only. Keys are
 * driver-independent (for example `consents/<id>.pdf`), so moving from local disk to S3 is a copy of
 * the files with no database change.
 */
export interface FileStorage {
  put(key: string, body: Buffer, contentType: string): Promise<StoredFile>;
  /** The file's bytes, or null when no file has that key. */
  get(key: string): Promise<Buffer | null>;
  /** Removes a file; a file that is already gone is not an error. */
  delete(key: string): Promise<void>;
}
