import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
} from './email.types.js';

export interface ResendOptions {
  apiKey: string;
  /** The sender, for example `Amentorz <onboarding@resend.dev>`; a verified domain is needed to reach other recipients. */
  from: string;
  /** Defaults to the Resend send-email endpoint. */
  endpoint?: string;
  timeoutMs?: number;
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Resend adapter over its HTTP API. Uses the platform fetch, so no SDK dependency is needed. The API key is
 * only ever placed in the Authorization header; it never appears in errors or logs.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ResendOptions) {
    this.endpoint = options.endpoint ?? RESEND_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = (err as Error).name === 'TimeoutError' ? 'timed out' : 'could not be reached';
      throw new EmailDeliveryError(`Resend ${reason}`, this.name, null, true);
    }

    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return { messageId: body.id ?? null };
    }

    // 429 and 5xx are transient; 4xx means the request itself was rejected (for example an unverified sender)
    const retryable = response.status === 429 || response.status >= 500;
    throw new EmailDeliveryError(
      `Resend rejected the message (HTTP ${response.status})`,
      this.name,
      response.status,
      retryable
    );
  }
}
