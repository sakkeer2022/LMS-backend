import { config } from '@config/index';
import type { FileStorage } from './storage.types.js';
import { LocalFileStorage } from './local-storage.js';
import { MemoryFileStorage } from './memory-storage.js';
import { S3FileStorage } from './s3-storage.js';
import { DropboxFileStorage } from './dropbox-storage.js';

export type { FileStorage, StoredFile } from './storage.types.js';
export { MemoryFileStorage } from './memory-storage.js';
export { sha256Hex } from './keys.js';

let storage: FileStorage | undefined;

/** The configured storage: S3 in production, Dropbox for temporary QA, local disk in development, memory under tests. */
export function getStorage(): FileStorage {
  if (!storage) {
    const { driver, localDir, s3, dropbox } = config.storage;
    if (driver === 's3') {
      if (!s3.bucket) throw new Error('STORAGE_S3_BUCKET is not configured');
      storage = new S3FileStorage(s3.bucket, s3.region, s3.prefix);
    } else if (driver === 'dropbox') {
      const { appKey, appSecret, refreshToken, pathPrefix } = dropbox;
      if (!appKey || !appSecret || !refreshToken)
        throw new Error('Dropbox storage is not configured');
      storage = new DropboxFileStorage({ appKey, appSecret, refreshToken }, pathPrefix);
    } else {
      storage = driver === 'memory' ? new MemoryFileStorage() : new LocalFileStorage(localDir);
    }
  }
  return storage;
}

/** The test storage. Throws when the driver is not `memory`. */
export function getTestStorage(): MemoryFileStorage {
  const current = getStorage();
  if (!(current instanceof MemoryFileStorage))
    throw new Error('The test storage needs STORAGE_DRIVER=memory');
  return current;
}
