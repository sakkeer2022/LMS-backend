import { config } from '@config/index';
import type { EmailProvider, EmailSender } from './email.types.js';
import { SendGridEmailProvider } from './sendgrid.provider.js';
import { ResendEmailProvider } from './resend.provider.js';
import { LogEmailProvider } from './log.provider.js';
import { InMemoryEmailProvider } from './memory.provider.js';
import { MemoryEmailSender } from './memory-sender.js';
import { SmtpEmailSender } from './smtp-sender.js';

export type { EmailMessage, EmailProvider, EmailSendResult, EmailSender } from './email.types.js';
export { EmailDeliveryError } from './email.types.js';
export { SendGridEmailProvider } from './sendgrid.provider.js';
export { ResendEmailProvider } from './resend.provider.js';
export { LogEmailProvider } from './log.provider.js';
export { InMemoryEmailProvider } from './memory.provider.js';
export { MemoryEmailSender } from './memory-sender.js';
export { otpEmail, type OtpPurposeCopy } from './templates.js';

/** An `EmailProvider` that sends through an `EmailSender` (SMTP has no message id). */
class SenderBackedEmailProvider implements EmailProvider {
  constructor(
    readonly name: string,
    private readonly sender: EmailSender
  ) {}

  async send(message: Parameters<EmailProvider['send']>[0]) {
    await this.sender.send(message);
    return { messageId: null };
  }
}

/** Builds the provider named by EMAIL_TRANSPORT. */
export function createEmailProvider(
  emailConfig: typeof config.email = config.email
): EmailProvider {
  switch (emailConfig.transport) {
    case 'sendgrid':
      // config validation guarantees both values when the transport is sendgrid
      return new SendGridEmailProvider({
        apiKey: emailConfig.sendgridApiKey as string,
        fromEmail: emailConfig.fromEmail as string,
        fromName: emailConfig.fromName,
      });
    case 'resend':
      // config validation guarantees the key when the transport is resend
      return new ResendEmailProvider({
        apiKey: emailConfig.resendApiKey as string,
        from: emailConfig.from,
      });
    case 'memory':
      return new InMemoryEmailProvider();
    case 'smtp':
      return new SenderBackedEmailProvider('smtp', new SmtpEmailSender());
    case 'log':
    default:
      return new LogEmailProvider();
  }
}

let currentProvider: EmailProvider | undefined;

/** The process-wide email provider (faculty invitations). */
export function getEmailProvider(): EmailProvider {
  currentProvider ??= createEmailProvider();
  return currentProvider;
}

/** Replaces the provider; for tests only. */
export function setEmailProvider(provider: EmailProvider): void {
  currentProvider = provider;
}

let sender: EmailSender | undefined;

/**
 * The configured sender for one-time codes: SMTP, the in-process outbox when
 * EMAIL_TRANSPORT=memory (tests), or the SendGrid/log provider otherwise.
 */
export function getEmailSender(): EmailSender {
  if (!sender) {
    const { transport } = config.email;
    if (transport === 'memory') sender = new MemoryEmailSender();
    else if (transport === 'smtp') sender = new SmtpEmailSender();
    else {
      const provider = createEmailProvider();
      sender = {
        send: async (message) => {
          await provider.send(message);
        },
      };
    }
  }
  return sender;
}

/** The test outbox. Throws when the transport is not `memory`, so a test cannot read a real mailbox. */
export function getTestOutbox(): MemoryEmailSender {
  const current = getEmailSender();
  if (!(current instanceof MemoryEmailSender))
    throw new Error('The test outbox needs EMAIL_TRANSPORT=memory');
  return current;
}
