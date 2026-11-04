import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import {
  StorageNotFoundError,
  assertStorageKey,
  type ObjectStorage,
  type StoredObject,
} from './storage.types.js';

/** Private S3 bucket storage. Objects are written with server-side encryption. */
export class S3Storage implements ObjectStorage {
  readonly name = 's3';
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    region: string,
    client?: S3Client
  ) {
    this.client = client ?? new S3Client({ region });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertStorageKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      })
    );
  }

  async get(key: string): Promise<StoredObject> {
    assertStorageKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) throw new StorageNotFoundError(key);
      return {
        body: Buffer.from(bytes),
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    } catch (err) {
      if (err instanceof NoSuchKey) throw new StorageNotFoundError(key);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
