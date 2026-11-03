import { config } from '@config/index';
import type { EmailSender } from './email.types.js';
import { MemoryEmailSender } from './memory-sender.js';
import { SmtpEmailSender } from './smtp-sender.js';

export type { EmailMessage, EmailSender } from './email.types.js';
export { MemoryEmailSender } from './memory-sender.js';
export { otpEmail, type OtpPurposeCopy } from './templates.js';

let sender: EmailSender | undefined;

/** The configured sender: SMTP, or the in-process outbox when EMAIL_TRANSPORT=memory (tests). */
export function getEmailSender(): EmailSender {
  sender ??= config.email.transport === 'memory' ? new MemoryEmailSender() : new SmtpEmailSender();
  return sender;
}

/** The test outbox. Throws when the transport is not `memory`, so a test cannot read a real mailbox. */
export function getTestOutbox(): MemoryEmailSender {
  const current = getEmailSender();
  if (!(current instanceof MemoryEmailSender))
    throw new Error('The test outbox needs EMAIL_TRANSPORT=memory');
  return current;
}
