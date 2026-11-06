import type { EmailMessage } from '@infrastructure/email/index';
import { escapeHtml } from './faculty.invite-email.js';

/**
 * Notification emails for the tutor lifecycle (LMS-39). Short, one purpose each; only
 * values the server controls or has validated are interpolated, always HTML-escaped.
 */

interface Block {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
}

function layout(block: Block): string {
  const paragraphs = block.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 12px;font-size:14px;line-height:22px;color:#4a4458;">${escapeHtml(p)}</p>`
    )
    .join('');
  const action = block.action
    ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(block.action.url)}" style="display:inline-block;background:#8b3a96;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 22px;border-radius:8px;">${escapeHtml(block.action.label)}</a></p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(block.heading)}</title></head>
<body style="margin:0;padding:32px 16px;background:#f4f4f6;font-family:Arial,Helvetica,sans-serif;color:#1d1b20;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e4ea;border-radius:12px;">
<tr><td style="padding:28px 32px;">
<p style="margin:0 0 20px;font-size:18px;font-weight:bold;">Amentorz</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:28px;">${escapeHtml(block.heading)}</h1>
${paragraphs}${action}
</td></tr></table></td></tr></table></body></html>`;
}

function message(to: string, subject: string, category: string, block: Block): EmailMessage {
  const text = [
    block.heading,
    '',
    ...block.paragraphs,
    ...(block.action ? ['', `${block.action.label}: ${block.action.url}`] : []),
    '',
    'The Amentorz team',
  ].join('\n');
  return { to, subject, text, html: layout(block), category };
}

export function applicationReceivedEmail(input: {
  to: string;
  fullName: string;
  reference: string;
}): EmailMessage {
  return message(input.to, `Application received (${input.reference})`, 'faculty-application', {
    heading: 'We have your application',
    paragraphs: [
      `Thanks, ${input.fullName}. Your application ${input.reference} has been submitted.`,
      'Operations verifies your ID, degree and PAN, usually within 3–5 working days. We will email you as your application progresses.',
    ],
  });
}

export function applicationApprovedEmail(input: { to: string; fullName: string }): EmailMessage {
  return message(input.to, 'Your Amentorz tutor profile is approved', 'faculty-approved', {
    heading: 'Your profile is approved',
    paragraphs: [
      `Congratulations, ${input.fullName}. Your documents are verified and your tutor profile is approved.`,
      'Next, we set the session price for each subject you teach. We will email you as soon as you can sign in.',
    ],
  });
}

export function applicationRejectedEmail(input: {
  to: string;
  fullName: string;
  reason: string;
}): EmailMessage {
  return message(input.to, 'Update on your Amentorz application', 'faculty-rejected', {
    heading: 'We could not approve your application',
    paragraphs: [
      `Hello ${input.fullName}, thank you for applying to teach on Amentorz.`,
      `Our team could not approve your application: ${input.reason}`,
      'If you have questions, reply to this email.',
    ],
  });
}

export function accountReadyEmail(input: {
  to: string;
  fullName: string;
  loginUrl: string;
}): EmailMessage {
  return message(input.to, 'You can now sign in to Amentorz', 'faculty-ready', {
    heading: 'Your tutor account is ready',
    paragraphs: [
      `Hello ${input.fullName}, your session prices are set.`,
      'Sign in to review and accept your prices, then set up your availability.',
    ],
    action: { label: 'Sign in', url: input.loginUrl },
  });
}

export function priceDeclinedEmail(input: {
  to: string;
  tutorName: string;
  tutorEmail: string;
  adminUrl: string;
}): EmailMessage {
  return message(
    input.to,
    `${input.tutorName} declined their session prices`,
    'faculty-price-declined',
    {
      heading: 'A tutor declined their prices',
      paragraphs: [
        `${input.tutorName} (${input.tutorEmail}) declined the session prices set for them.`,
        'Review the prices on the Pricing screen; changing them asks the tutor to accept again.',
      ],
      action: { label: 'Open Pricing', url: input.adminUrl },
    }
  );
}
