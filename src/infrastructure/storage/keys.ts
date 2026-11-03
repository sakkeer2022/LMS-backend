import crypto from 'node:crypto';

/** Keys look like `consents/<uuid>.pdf`: lowercase path segments, no dot segments, no absolute paths. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;

export function assertValidKey(key: string): void {
  if (key.length > 255 || !KEY_PATTERN.test(key) || key.includes('..')) {
    throw new Error('Invalid storage key');
  }
}

export const sha256Hex = (body: Buffer): string =>
  crypto.createHash('sha256').update(body).digest('hex');
