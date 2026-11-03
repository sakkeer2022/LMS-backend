import { config } from '@config/index';
import type { EmailProvider } from './email.types.js';
import { SendGridEmailProvider } from './sendgrid.provider.js';
import { LogEmailProvider } from './log.provider.js';
import { InMemoryEmailProvider } from './memory.provider.js';

export type { EmailMessage, EmailProvider, EmailSendResult } from './email.types.js';
export { EmailDeliveryError } from './email.types.js';
export { SendGridEmailProvider } from './sendgrid.provider.js';
export { LogEmailProvider } from './log.provider.js';
export { InMemoryEmailProvider } from './memory.provider.js';

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
    case 'memory':
      return new InMemoryEmailProvider();
    case 'log':
    default:
      return new LogEmailProvider();
  }
}

let current: EmailProvider | undefined;

/** The process-wide email provider. */
export function getEmailProvider(): EmailProvider {
  current ??= createEmailProvider();
  return current;
}

/** Replaces the provider; for tests only. */
export function setEmailProvider(provider: EmailProvider): void {
  current = provider;
}
