import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '@config/index';
import { logger } from '@core/logger/index';
import type { EmailMessage, EmailSender } from './email.types.js';

export class SmtpEmailSender implements EmailSender {
  private transporter: Transporter | undefined;

  private connection(): Transporter {
    const { host, port, secure, user, pass } = config.email.smtp;
    if (!host) throw new Error('SMTP_HOST is not configured, so no email can be sent');
    this.transporter ??= nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<void> {
    await this.connection().sendMail({ from: config.email.from, ...message });
    // The body can hold a one-time code, so it is never logged
    logger.info({ subject: message.subject }, 'email sent');
  }
}
