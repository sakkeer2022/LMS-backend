import { randomUUID } from 'node:crypto';
import { config } from '@config/index';
import { logger } from '@core/logger/index';
import type { EmailMessage, EmailProvider, EmailSendResult } from './email.types.js';

/**
 * Development transport: records that a message would have been sent. Logs the
 * category only, never the recipient, subject or body, because bodies can carry
 * single-use links. Only when NODE_ENV=development it also prints the recipient and
 * text, so a one-time code can be read from the terminal without a mailbox.
 */
export class LogEmailProvider implements EmailProvider {
  readonly name = 'log';

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const messageId = `log-${randomUUID()}`;
    logger.info(
      {
        type: 'email',
        transport: this.name,
        category: message.category,
        messageId,
        ...(config.env === 'development' && { to: message.to, text: message.text }),
      },
      'Email not sent (EMAIL_TRANSPORT=log)'
    );
    return { messageId };
  }
}
