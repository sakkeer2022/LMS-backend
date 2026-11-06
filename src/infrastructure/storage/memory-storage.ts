import type { FileStorage, StoredFile } from './storage.types.js';
import { assertValidKey, sha256Hex } from './keys.js';

/** Test double: keeps files in process memory. */
export class MemoryFileStorage implements FileStorage {
  readonly files = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string): Promise<StoredFile> {
    assertValidKey(key);
    this.files.set(key, { body: Buffer.from(body), contentType });
    return { key, sha256: sha256Hex(body), size: body.length };
  }

  async get(key: string): Promise<Buffer | null> {
    assertValidKey(key);
    return this.files.get(key)?.body ?? null;
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    this.files.delete(key);
  }

  clear(): void {
    this.files.clear();
  }
}
