import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  EmailDeliveryError,
  InMemoryEmailProvider,
  LogEmailProvider,
  SendGridEmailProvider,
  createEmailProvider,
  getEmailProvider,
  setEmailProvider,
  type EmailMessage,
} from '../../src/infrastructure/email/index.js';
import { logger } from '../../src/core/logger/index.js';

const message: EmailMessage = {
  to: 'tutor@example.org',
  subject: 'Subject line',
  html: '<p>Hello</p>',
  text: 'Hello',
  category: 'faculty-invitation',
};

const API_KEY = 'SG.super-secret-key';

function sendgrid(fetchImpl: typeof fetch) {
  return new SendGridEmailProvider({
    apiKey: API_KEY,
    fromEmail: 'no-reply@amentorz.com',
    fromName: 'Amentorz',
    fetchImpl,
  });
}

describe('SendGridEmailProvider', () => {
  it('posts a v3 Mail Send request with the key only in the Authorization header', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202, headers: { 'x-message-id': 'abc123' } }));
    const result = await sendgrid(fetchImpl as unknown as typeof fetch).send(message);

    expect(result).toEqual({ messageId: 'abc123' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
    const body = JSON.parse(init.body as string);
    expect(body.personalizations).toEqual([{ to: [{ email: 'tutor@example.org' }] }]);
    expect(body.from).toEqual({ email: 'no-reply@amentorz.com', name: 'Amentorz' });
    expect(body.subject).toBe('Subject line');
    expect(body.content).toEqual([
      { type: 'text/plain', value: 'Hello' },
      { type: 'text/html', value: '<p>Hello</p>' },
    ]);
    // Click tracking would rewrite single-use links
    expect(body.tracking_settings.click_tracking.enable).toBe(false);
    expect(init.body).not.toContain(API_KEY);
  });

  it('returns a null message id when SendGrid sends none', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    expect(await sendgrid(fetchImpl as unknown as typeof fetch).send(message)).toEqual({ messageId: null });
  });

  it('throws a non-retryable EmailDeliveryError on 4xx without leaking the key or body', async () => {
    const fetchImpl = vi.fn(async () => new Response(`bad key ${API_KEY}`, { status: 401 }));
    const err = await sendgrid(fetchImpl as unknown as typeof fetch).send(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect(err).toMatchObject({ provider: 'sendgrid', status: 401, retryable: false });
    expect((err as Error).message).toBe('SendGrid rejected the message (HTTP 401)');
    expect((err as Error).message).not.toContain(API_KEY);
  });

  it.each([429, 500, 503])('marks HTTP %s as retryable', async (status) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status }));
    await expect(sendgrid(fetchImpl as unknown as typeof fetch).send(message)).rejects.toMatchObject({
      status,
      retryable: true,
    });
  });

  it('reports a network failure as retryable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(sendgrid(fetchImpl as unknown as typeof fetch).send(message)).rejects.toMatchObject({
      message: 'SendGrid could not be reached',
      status: null,
      retryable: true,
    });
  });

  it('reports a timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    });
    await expect(sendgrid(fetchImpl as unknown as typeof fetch).send(message)).rejects.toMatchObject({
      message: 'SendGrid timed out',
    });
  });
});

describe('InMemoryEmailProvider', () => {
  it('records sent messages and can fail on demand', async () => {
    const provider = new InMemoryEmailProvider();
    provider.failNext(new EmailDeliveryError('down', 'memory'));
    await expect(provider.send(message)).rejects.toThrow('down');
    const result = await provider.send(message);
    expect(result.messageId).toMatch(/^memory-/);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toMatchObject({ to: 'tutor@example.org', subject: 'Subject line' });
    provider.clear();
    expect(provider.sent).toHaveLength(0);
  });
});

describe('LogEmailProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs the category only, never the recipient, subject or body', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined as never);
    const result = await new LogEmailProvider().send({ ...message, html: '<a href="https://x/?token=secret">' });
    expect(result.messageId).toMatch(/^log-/);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain('faculty-invitation');
    expect(logged).not.toContain('tutor@example.org');
    expect(logged).not.toContain('Subject line');
    expect(logged).not.toContain('secret');
  });
});

describe('createEmailProvider', () => {
  const base = { sendgridApiKey: undefined, fromEmail: undefined, fromName: 'Amentorz' };

  it.each([
    ['log', LogEmailProvider],
    ['memory', InMemoryEmailProvider],
  ] as const)('builds the %s transport', (transport, type) => {
    expect(createEmailProvider({ ...base, transport } as never)).toBeInstanceOf(type);
  });

  it('builds the sendgrid transport', () => {
    const provider = createEmailProvider({
      ...base,
      transport: 'sendgrid',
      sendgridApiKey: 'SG.key',
      fromEmail: 'no-reply@amentorz.com',
    } as never);
    expect(provider).toBeInstanceOf(SendGridEmailProvider);
    expect(provider.name).toBe('sendgrid');
  });

  it('uses the in-memory transport under NODE_ENV=test and allows replacing it', () => {
    expect(getEmailProvider().name).toBe('memory');
    const replacement = new InMemoryEmailProvider();
    setEmailProvider(replacement);
    expect(getEmailProvider()).toBe(replacement);
  });
});
