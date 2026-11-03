export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** The only email surface services depend on. Production sends over SMTP; tests keep an outbox. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
