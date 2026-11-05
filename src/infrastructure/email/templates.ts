import { renderHtml, renderText, type EmailBlock } from './layout.js';

export type OtpPurposeCopy = 'registration' | 'recovery' | 'password-change';

const COPY: Record<OtpPurposeCopy, { subject: string; heading: string; intro: string }> = {
  registration: {
    subject: 'Your Amentorz verification code',
    heading: 'Verify your email',
    intro:
      'Use this code to verify your email address and continue creating your Amentorz account.',
  },
  recovery: {
    subject: 'Your Amentorz password reset code',
    heading: 'Reset your password',
    intro: 'Use this code to reset your Amentorz password.',
  },
  'password-change': {
    subject: 'Your Amentorz password change code',
    heading: 'Confirm your password change',
    intro: 'Use this code to confirm the change of your Amentorz password.',
  },
};

/** The email carrying a six-digit one-time code: branded HTML with a plain-text alternative. */
export function otpEmail(purpose: OtpPurposeCopy, code: string, expiresInMinutes: number) {
  const { subject, heading, intro } = COPY[purpose];
  const block: EmailBlock = {
    preheader: `${code} is your Amentorz code. It expires in ${expiresInMinutes} minutes.`,
    heading,
    paragraphs: [intro],
    closing: [
      `It expires in ${expiresInMinutes} minutes and works once. If you did not ask for it, you can ignore this email.`,
      'Amentorz will never ask you for this code by phone or chat.',
    ],
    code,
  };
  return { subject, text: renderText(block), html: renderHtml(block) };
}
