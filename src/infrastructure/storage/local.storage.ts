import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  StorageNotFoundError,
  assertStorageKey,
  type ObjectStorage,
  type StoredObject,
} from './storage.types.js';

/**
 * Local disk storage for development and single-server installs. The directory must not
 * be served by any web server. The content type is kept in a sidecar file.
 */
export class LocalDiskStorage implements ObjectStorage {
  readonly name = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    assertStorageKey(key);
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return target;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, body, { mode: 0o600 });
    await fs.writeFile(`${target}.type`, contentType, { mode: 0o600 });
  }

  async get(key: string): Promise<StoredObject> {
    const target = this.resolve(key);
    try {
      const [body, contentType] = await Promise.all([
        fs.readFile(target),
        fs.readFile(`${target}.type`, 'utf8').catch(() => 'application/octet-stream'),
      ]);
      return { body, contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageNotFoundError(key);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key);
    await Promise.all([fs.rm(target, { force: true }), fs.rm(`${target}.type`, { force: true })]);
  }
}
