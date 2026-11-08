import { randomUUID } from 'node:crypto';
import { config } from '@config/index';
import { logger } from '@core/logger/index';
import { writeDevMailbox } from './dev-mailbox.js';
import type { EmailMessage, EmailProvider, EmailSendResult } from './email.types.js';

/**
 * Development transport: records that a message would have been sent. Logs the
 * category only, never the recipient, subject or body, because bodies can carry
 * single-use links. Only when NODE_ENV=development it also prints the recipient and
 * text to a file (EMAIL_LOG_FILE, `npm run mail` shows the latest), so a one-time code can be
 * found without a mailbox and without searching the terminal. If the file cannot be written the
 * text goes to the terminal instead, so a code is never lost.
 */
export class LogEmailProvider implements EmailProvider {
  readonly name = 'log';

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const messageId = `log-${randomUUID()}`;
    let written: { file: string } | { to: string; text: string } | undefined;
    if (config.env === 'development') {
      try {
        writeDevMailbox(message, config.email.logFile);
        written = { file: config.email.logFile };
      } catch {
        written = { to: message.to, text: message.text };
      }
    }
    logger.info(
      { type: 'email', transport: this.name, category: message.category, messageId, ...written },
      'Email not sent (EMAIL_TRANSPORT=log)'
    );
    return { messageId };
  }
}
