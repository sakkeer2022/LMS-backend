import type { FileStorage, StoredFile } from './storage.types.js';
import { assertValidKey, sha256Hex } from './keys.js';

export interface DropboxCredentials {
  appKey: string;
  appSecret: string;
  refreshToken: string;
}

/**
 * Temporary storage for QA on a free host without a disk: files live in the Dropbox app folder.
 * Not for production (config requires s3 there). Keys are the same as every other driver, so moving to
 * S3 is a copy of the files with no database change. Access tokens last hours, so each is renewed from
 * the refresh token. Dropbox rejects a single upload over 150 MB, far above the policy and consent limits.
 */
export class DropboxFileStorage implements FileStorage {
  private token: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly credentials: DropboxCredentials,
    private readonly prefix = '',
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private pathFor(key: string): string {
    assertValidKey(key);
    const folder = this.prefix.replace(/^\/+|\/+$/g, '');
    return `/${folder ? `${folder}/` : ''}${key}`;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const { appKey, appSecret, refreshToken } = this.credentials;
    const response = await this.fetcher('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!response.ok) throw new Error(`Dropbox token refresh failed (${response.status})`);
    const { access_token: value, expires_in: seconds } = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = { value, expiresAt: Date.now() + (seconds - 60) * 1000 };
    return value;
  }

  /** Calls Dropbox once more with a fresh token when the cached one was rejected. */
  private async call(
    url: string,
    headers: Record<string, string>,
    body?: Buffer | string
  ): Promise<Response> {
    const send = async (): Promise<Response> =>
      this.fetcher(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await this.accessToken()}`, ...headers },
        body,
      });
    const response = await send();
    if (response.status !== 401) return response;
    this.token = undefined;
    return send();
  }

  private static async summaryOf(response: Response): Promise<string | undefined> {
    const body = (await response
      .clone()
      .json()
      .catch(() => ({}))) as { error_summary?: string };
    return body.error_summary;
  }

  private async fail(response: Response, action: string): Promise<never> {
    // Only the status and Dropbox's error summary, never the headers (they hold the token)
    const summary = await DropboxFileStorage.summaryOf(response);
    throw new Error(`Dropbox ${action} failed (${response.status}${summary ? ` ${summary}` : ''})`);
  }

  private static async isNotFound(response: Response): Promise<boolean> {
    return (
      response.status === 409 &&
      ((await DropboxFileStorage.summaryOf(response)) ?? '').includes('not_found')
    );
  }

  async put(key: string, body: Buffer): Promise<StoredFile> {
    const response = await this.call(
      'https://content.dropboxapi.com/2/files/upload',
      {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: this.pathFor(key),
          mode: 'overwrite',
          mute: true,
        }),
      },
      body
    );
    if (!response.ok) await this.fail(response, 'upload');
    return { key, sha256: sha256Hex(body), size: body.length };
  }

  async get(key: string): Promise<Buffer | null> {
    const response = await this.call('https://content.dropboxapi.com/2/files/download', {
      'Dropbox-API-Arg': JSON.stringify({ path: this.pathFor(key) }),
    });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (await DropboxFileStorage.isNotFound(response)) return null;
    return this.fail(response, 'download');
  }

  async delete(key: string): Promise<void> {
    const response = await this.call(
      'https://api.dropboxapi.com/2/files/delete_v2',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ path: this.pathFor(key) })
    );
    if (response.ok) return;
    if (!(await DropboxFileStorage.isNotFound(response))) await this.fail(response, 'delete');
  }
}
