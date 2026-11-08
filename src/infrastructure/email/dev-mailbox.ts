import fs from 'node:fs';
import path from 'node:path';
import type { EmailMessage } from './email.types.js';

/** Separates the messages in the development mailbox file; scripts/dev-mail.cjs splits on it. */
export const MAILBOX_SEPARATOR = '==== ';

/**
 * Appends a message to the development mailbox file, newest last. Used by EMAIL_TRANSPORT=log in
 * development only: the body can hold one-time codes and links, so the file lives in the git-ignored
 * .data folder and is never written in any other environment.
 */
export function writeDevMailbox(message: EmailMessage, file: string, now: Date = new Date()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry =
    `${MAILBOX_SEPARATOR}${now.toISOString()}  ${message.category ?? 'email'}\n` +
    `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n\n`;
  fs.appendFileSync(file, entry);
}
