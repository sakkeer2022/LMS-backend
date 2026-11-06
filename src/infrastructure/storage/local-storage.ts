import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileStorage, StoredFile } from './storage.types.js';
import { assertValidKey, sha256Hex } from './keys.js';

/** Development storage on local disk, outside any web-served folder. Not allowed in production. */
export class LocalFileStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep))
      throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer): Promise<StoredFile> {
    const target = this.pathFor(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Written to a temporary name first so a reader never sees half a file
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, body, { mode: 0o600 });
    await fs.rename(temporary, target);
    return { key, sha256: sha256Hex(body), size: body.length };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.pathFor(key), { force: true });
  }
}
