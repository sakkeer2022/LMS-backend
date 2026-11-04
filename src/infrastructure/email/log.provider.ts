import { randomUUID } from 'node:crypto';
import { logger } from '@core/logger/index';
import type { EmailMessage, EmailProvider, EmailSendResult } from './email.types.js';

/**
 * Development transport: records that a message would have been sent. Logs the
 * category only, never the recipient, subject or body, because bodies can carry
 * single-use links.
 */
export class LogEmailProvider implements EmailProvider {
  readonly name = 'log';

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const messageId = `log-${randomUUID()}`;
    logger.info(
      { type: 'email', transport: this.name, category: message.category, messageId },
      'Email not sent (EMAIL_TRANSPORT=log)'
    );
    return { messageId };
  }
}
