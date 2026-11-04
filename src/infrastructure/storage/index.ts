import { config } from '@config/index';
import type { ObjectStorage } from './storage.types.js';
import { LocalDiskStorage } from './local.storage.js';
import { InMemoryStorage } from './memory.storage.js';
import { S3Storage } from './s3.storage.js';

export type { ObjectStorage, StoredObject } from './storage.types.js';
export { StorageNotFoundError, STORAGE_KEY_PATTERN } from './storage.types.js';
export { LocalDiskStorage } from './local.storage.js';
export { InMemoryStorage } from './memory.storage.js';
export { S3Storage } from './s3.storage.js';

/** Builds the storage named by STORAGE_DRIVER. */
export function createObjectStorage(
  storage: typeof config.storage = config.storage
): ObjectStorage {
  switch (storage.driver) {
    case 's3':
      return new S3Storage(storage.s3Bucket, storage.s3Region);
    case 'memory':
      return new InMemoryStorage();
    case 'local':
    default:
      return new LocalDiskStorage(storage.localDir);
  }
}

let current: ObjectStorage | undefined;

export function getObjectStorage(): ObjectStorage {
  current ??= createObjectStorage();
  return current;
}

/** Replaces the storage; for tests only. */
export function setObjectStorage(storage: ObjectStorage): void {
  current = storage;
}
