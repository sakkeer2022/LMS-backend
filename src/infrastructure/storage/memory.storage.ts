import {
  StorageNotFoundError,
  assertStorageKey,
  type ObjectStorage,
  type StoredObject,
} from './storage.types.js';

/** In-memory test double. */
export class InMemoryStorage implements ObjectStorage {
  readonly name = 'memory';
  readonly objects = new Map<string, StoredObject>();
  private failures: Error[] = [];

  /** The next put throws `error`. */
  failNextPut(error: Error): void {
    this.failures.push(error);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertStorageKey(key);
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async get(key: string): Promise<StoredObject> {
    const found = this.objects.get(key);
    if (!found) throw new StorageNotFoundError(key);
    return found;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
