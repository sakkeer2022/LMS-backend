import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { FileStorage, StoredFile } from './storage.types.js';
import { assertValidKey, sha256Hex } from './keys.js';

/**
 * S3 storage for signed consents and policies. Use a private bucket of its own (not the upload quarantine
 * bucket) with versioning on; objects are encrypted at rest and never served by link: every download goes
 * through the API, which checks who is asking and writes the audit entry.
 */
export class S3FileStorage implements FileStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    region: string,
    private readonly prefix = '',
    client?: S3Client
  ) {
    this.client = client ?? new S3Client({ region });
  }

  private objectKey(key: string): string {
    assertValidKey(key);
    return `${this.prefix}${key}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredFile> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      })
    );
    return { key, sha256: sha256Hex(body), size: body.length };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
      );
      const bytes = await response.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
    );
  }
}
