import { config } from '@config/index';
import { renderHtml, renderText, type EmailBlock } from '@infrastructure/email/layout.js';

/** The email an admin-created user receives: who they are, the password the admin set, and where to sign in. */
export function accountCreatedEmail(input: {
  to: string;
  fullName: string;
  password: string;
  roleNames: string[];
  /** The password was reset, not a new account */
  reset?: boolean;
}) {
  const block: EmailBlock = {
    preheader: input.reset
      ? 'Your Amentorz password was reset.'
      : 'Your Amentorz admin account is ready.',
    heading: input.reset ? 'Your Amentorz password was reset' : 'Your Amentorz account is ready',
    paragraphs: [
      input.reset
        ? `Hello ${input.fullName}, an administrator has reset your Amentorz password. Your sign-in details are below.`
        : `Hello ${input.fullName}, an administrator has created an Amentorz admin account for you.`,
      `Email: ${input.to}`,
      `Password: ${input.password}`,
      input.roleNames.length ? `Role: ${input.roleNames.join(', ')}` : 'Role: none yet',
    ],
    action: { label: 'Sign in', url: `${config.appBaseUrl}/login` },
    closing: [
      'You will be asked to choose your own password when you sign in. Do not share this one with anyone.',
      'If you were not expecting this email, you can ignore it.',
    ],
  };
  return {
    to: input.to,
    subject: input.reset ? 'Your Amentorz password was reset' : 'Your Amentorz account',
    text: renderText(block),
    html: renderHtml(block),
    category: 'account-created',
  };
}
