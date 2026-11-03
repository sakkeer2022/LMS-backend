import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalFileStorage } from '@infrastructure/storage/local-storage.js';
import { MemoryFileStorage } from '@infrastructure/storage/memory-storage.js';
import { S3FileStorage } from '@infrastructure/storage/s3-storage.js';
import { sha256Hex } from '@infrastructure/storage/keys.js';

const body = Buffer.from('%PDF-1.7 test file');
const expectedSha = sha256Hex(body);

function behavesLikeStorage(
  name: string,
  make: () => Promise<{ storage: MemoryFileStorage | LocalFileStorage }>
) {
  describe(name, () => {
    it('stores a file and returns its hash and size', async () => {
      const { storage } = await make();
      const stored = await storage.put('consents/abc-123.pdf', body, 'application/pdf');
      expect(stored).toEqual({
        key: 'consents/abc-123.pdf',
        sha256: expectedSha,
        size: body.length,
      });
      expect(await storage.get('consents/abc-123.pdf')).toEqual(body);
    });

    it('returns null for a missing file and tolerates deleting one that is gone', async () => {
      const { storage } = await make();
      expect(await storage.get('consents/none.pdf')).toBeNull();
      await expect(storage.delete('consents/none.pdf')).resolves.toBeUndefined();
    });

    it('deletes a file', async () => {
      const { storage } = await make();
      await storage.put('policies/terms_of_use/in/1.0.pdf', body, 'application/pdf');
      await storage.delete('policies/terms_of_use/in/1.0.pdf');
      expect(await storage.get('policies/terms_of_use/in/1.0.pdf')).toBeNull();
    });

    it.each(['../escape.pdf', '/etc/passwd', 'a/../../b.pdf', 'consents//x.pdf', '', 'a b.pdf'])(
      'rejects the key %j',
      async (key) => {
        const { storage } = await make();
        await expect(storage.put(key, body, 'application/pdf')).rejects.toThrow(
          'Invalid storage key'
        );
        await expect(storage.get(key)).rejects.toThrow('Invalid storage key');
      }
    );
  });
}

behavesLikeStorage('memory storage', async () => ({ storage: new MemoryFileStorage() }));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
behavesLikeStorage('local storage', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amentorz-storage-'));
  dirs.push(dir);
  return { storage: new LocalFileStorage(dir) };
});

describe('S3 storage', () => {
  it('writes private encrypted objects under the prefix and reads them back', async () => {
    const send = vi.fn(
      async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
        }
        return {};
      }
    );
    const storage = new S3FileStorage('consents-bucket', 'ap-south-1', 'prod/', { send } as never);

    const stored = await storage.put('consents/abc.pdf', body, 'application/pdf');
    expect(stored.sha256).toBe(expectedSha);
    const put = send.mock.calls[0]![0];
    expect(put.input).toMatchObject({
      Bucket: 'consents-bucket',
      Key: 'prod/consents/abc.pdf',
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256',
    });
    expect(await storage.get('consents/abc.pdf')).toEqual(body);
  });

  it('returns null when the object does not exist', async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error('gone'), { name: 'NoSuchKey' });
    });
    const storage = new S3FileStorage('b', 'ap-south-1', '', { send } as never);
    expect(await storage.get('consents/none.pdf')).toBeNull();
  });
});
