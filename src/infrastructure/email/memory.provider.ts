import { randomUUID } from 'node:crypto';
import type { EmailMessage, EmailProvider, EmailSendResult } from './email.types.js';

/** In-memory test double: keeps sent messages so tests can assert on them. */
export class InMemoryEmailProvider implements EmailProvider {
  readonly name = 'memory';
  readonly sent: (EmailMessage & { messageId: string })[] = [];
  private failures: Error[] = [];

  /** The next `count` sends throw `error`. */
  failNext(error: Error, count = 1): void {
    for (let i = 0; i < count; i += 1) this.failures.push(error);
  }

  clear(): void {
    this.sent.length = 0;
    this.failures = [];
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    const messageId = `memory-${randomUUID()}`;
    this.sent.push({ ...message, messageId });
    return { messageId };
  }
}
