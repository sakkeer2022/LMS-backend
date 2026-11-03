export type OtpPurposeCopy = 'registration' | 'recovery' | 'password-change';

const COPY: Record<OtpPurposeCopy, { subject: string; intro: string }> = {
  registration: {
    subject: 'Your Amentorz verification code',
    intro:
      'Use this code to verify your email address and continue creating your Amentorz account.',
  },
  recovery: {
    subject: 'Your Amentorz password reset code',
    intro: 'Use this code to reset your Amentorz password.',
  },
  'password-change': {
    subject: 'Your Amentorz password change code',
    intro: 'Use this code to confirm the change of your Amentorz password.',
  },
};

export function otpEmail(purpose: OtpPurposeCopy, code: string, expiresInMinutes: number) {
  const { subject, intro } = COPY[purpose];
  const text = [
    intro,
    '',
    `Your code: ${code}`,
    '',
    `It expires in ${expiresInMinutes} minutes and works once. If you did not ask for it, you can ignore this email.`,
    'Amentorz will never ask you for this code by phone or chat.',
  ].join('\n');
  return { subject, text };
}
