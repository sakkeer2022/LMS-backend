import type { EmailMessage, EmailSender } from './email.types.js';

/** Test double: keeps every message so a test can read the code that was "sent". */
export class MemoryEmailSender implements EmailSender {
  readonly outbox: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.outbox.push(message);
  }

  to(address: string): EmailMessage[] {
    return this.outbox.filter((m) => m.to.toLowerCase() === address.toLowerCase());
  }

  clear(): void {
    this.outbox.length = 0;
  }
}
