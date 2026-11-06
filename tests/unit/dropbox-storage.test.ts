import { describe, expect, it } from 'vitest';
import { DropboxFileStorage } from '@infrastructure/storage/dropbox-storage.js';
import { sha256Hex } from '@infrastructure/storage/keys.js';

const body = Buffer.from('%PDF-1.7 test file');
const credentials = { appKey: 'key', appSecret: 'secret', refreshToken: 'refresh' };

/** A stand-in for the four Dropbox endpoints the driver uses. `rejectNextToken` makes one access token fail with 401. */
function fakeDropbox() {
  const files = new Map<string, Buffer>();
  const state = { tokens: 0, rejectNextToken: false, lastToken: '' };
  const notFound = () =>
    new Response(JSON.stringify({ error_summary: 'path/not_found/..' }), { status: 409 });
  const fetcher = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    if (url.endsWith('/oauth2/token')) {
      state.tokens += 1;
      return Response.json({ access_token: `token-${state.tokens}`, expires_in: 14400 });
    }
    state.lastToken = headers.Authorization ?? '';
    if (state.rejectNextToken) {
      state.rejectNextToken = false;
      return new Response('{}', { status: 401 });
    }
    const arg = JSON.parse(headers['Dropbox-API-Arg'] ?? (init.body as string)) as { path: string };
    if (url.endsWith('/files/upload')) {
      files.set(arg.path, init.body as Buffer);
      return Response.json({});
    }
    if (url.endsWith('/files/download')) {
      const file = files.get(arg.path);
      return file ? new Response(new Uint8Array(file)) : notFound();
    }
    if (url.endsWith('/files/delete_v2'))
      return files.delete(arg.path) ? Response.json({}) : notFound();
    return new Response('{}', { status: 500 });
  }) as unknown as typeof fetch;
  return { files, state, fetcher };
}

describe('dropbox storage', () => {
  it('stores, reads and deletes a file under the prefix', async () => {
    const { files, fetcher } = fakeDropbox();
    const storage = new DropboxFileStorage(credentials, '/amentorz-qa/', fetcher);
    const stored = await storage.put('consents/abc-123.pdf', body, 'application/pdf');
    expect(stored).toEqual({
      key: 'consents/abc-123.pdf',
      sha256: sha256Hex(body),
      size: body.length,
    });
    expect([...files.keys()]).toEqual(['/amentorz-qa/consents/abc-123.pdf']);
    expect(await storage.get('consents/abc-123.pdf')).toEqual(body);
    await storage.delete('consents/abc-123.pdf');
    expect(await storage.get('consents/abc-123.pdf')).toBeNull();
  });

  it('returns null for a missing file and tolerates deleting one that is gone', async () => {
    const storage = new DropboxFileStorage(credentials, '', fakeDropbox().fetcher);
    expect(await storage.get('consents/none.pdf')).toBeNull();
    await expect(storage.delete('consents/none.pdf')).resolves.toBeUndefined();
  });

  it('reuses one access token and renews it once after a 401', async () => {
    const { state, fetcher } = fakeDropbox();
    const storage = new DropboxFileStorage(credentials, '', fetcher);
    await storage.put('a/one.pdf', body, 'application/pdf');
    await storage.get('a/one.pdf');
    expect(state.tokens).toBe(1);
    state.rejectNextToken = true;
    await storage.get('a/one.pdf');
    expect(state.tokens).toBe(2);
    expect(state.lastToken).toBe('Bearer token-2');
  });

  it.each(['../escape.pdf', '/etc/passwd', 'a/../../b.pdf', 'consents//x.pdf', '', 'a b.pdf'])(
    'rejects the key %j',
    async (key) => {
      const storage = new DropboxFileStorage(credentials, '', fakeDropbox().fetcher);
      await expect(storage.put(key, body, 'application/pdf')).rejects.toThrow(
        'Invalid storage key'
      );
      await expect(storage.get(key)).rejects.toThrow('Invalid storage key');
    }
  );
});
