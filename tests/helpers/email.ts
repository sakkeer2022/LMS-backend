import { getTestOutbox } from '@infrastructure/email/index.js';

/** The six-digit code in the most recent email sent to an address (test outbox only). */
export function latestOtp(email: string): string {
  const messages = getTestOutbox().to(email);
  const last = messages[messages.length - 1];
  const code = last?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No code was emailed to ${email}`);
  return code;
}
