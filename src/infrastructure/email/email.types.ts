/**
 * Email contracts. Services depend on these interfaces, never on a mail SDK or HTTP API
 * directly; the transport is chosen by configuration (EMAIL_TRANSPORT), so switching
 * transport is a settings change.
 *
 * Two interfaces exist for now (see docs/PENDING_DECISIONS.md): `EmailSender` (registration,
 * recovery and password-change codes) and `EmailProvider` (faculty invitations, LMS-79).
 * Both accept the same `EmailMessage` and use the same configured transport.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body; also the alternative for clients that do not render HTML. */
  text: string;
  html?: string;
  /** Short label used in logs and metrics, never the message body. */
  category?: string;
}

/** The email surface the OTP flows depend on. Production sends over SMTP; tests keep an outbox. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface EmailSendResult {
  /** Provider message id, when the provider returns one. */
  messageId: string | null;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** The provider rejected or could not accept a message. Safe to show its message to admins. */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly status: number | null = null,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}
