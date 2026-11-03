import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
} from './email.types.js';

export interface SendGridOptions {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  /** Defaults to the SendGrid v3 Mail Send endpoint. */
  endpoint?: string;
  timeoutMs?: number;
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const SENDGRID_ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';

/**
 * SendGrid adapter over the v3 Mail Send HTTP API. Uses the platform fetch, so no
 * SDK dependency is needed. The API key is only ever placed in the Authorization
 * header; it never appears in errors or logs.
 */
export class SendGridEmailProvider implements EmailProvider {
  readonly name = 'sendgrid';
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SendGridOptions) {
    this.endpoint = options.endpoint ?? SENDGRID_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** The request body SendGrid expects. Exported through the class for tests. */
  buildPayload(message: EmailMessage): Record<string, unknown> {
    return {
      personalizations: [{ to: [{ email: message.to }] }],
      from: { email: this.options.fromEmail, name: this.options.fromName },
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
      ],
      ...(message.category ? { categories: [message.category] } : {}),
      // Invitation links carry single-use tokens; click tracking would rewrite them.
      tracking_settings: { click_tracking: { enable: false, enable_text: false } },
    };
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
        body: JSON.stringify(this.buildPayload(message)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = (err as Error).name === 'TimeoutError' ? 'timed out' : 'could not be reached';
      throw new EmailDeliveryError(`SendGrid ${reason}`, this.name, null, true);
    }

    if (response.status === 202 || response.ok) {
      return { messageId: response.headers.get('x-message-id') };
    }

    // 429 and 5xx are transient; 4xx means the request itself was rejected
    const retryable = response.status === 429 || response.status >= 500;
    throw new EmailDeliveryError(
      `SendGrid rejected the message (HTTP ${response.status})`,
      this.name,
      response.status,
      retryable
    );
  }
}
