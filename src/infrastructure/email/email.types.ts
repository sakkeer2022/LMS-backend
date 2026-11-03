/**
 * Email sending contract (LMS-97, LMS-79). Services depend on this interface,
 * never on a provider SDK or HTTP API directly. The transport is chosen by
 * configuration (EMAIL_TRANSPORT), so switching provider is a settings change.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative for clients that do not render HTML. */
  text: string;
  /** Short label used in logs and metrics, never the message body. */
  category: string;
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
