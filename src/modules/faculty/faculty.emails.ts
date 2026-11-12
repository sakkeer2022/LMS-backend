import type { EmailMessage } from '@infrastructure/email/index';
import { describeValidity, escapeHtml, formatExpiry } from './faculty.invite-email.js';

/**
 * Notification emails for the tutor lifecycle (LMS-39). Short, one purpose each; only
 * values the server controls or has validated are interpolated, always HTML-escaped.
 */

interface Block {
  heading: string;
  paragraphs: string[];
  /** A highlighted panel, e.g. the admin's reason */
  note?: { title: string; text: string };
  action?: { label: string; url: string };
  /** Small print under the action, e.g. when the link expires */
  footnote?: string;
}

function layout(block: Block): string {
  const paragraphs = block.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 12px;font-size:14px;line-height:22px;color:#4a4458;">${escapeHtml(p)}</p>`
    )
    .join('');
  const note = block.note
    ? `<div style="margin:4px 0 16px;padding:12px 14px;border-left:3px solid #8b3a96;border-radius:6px;background:#f7f1f8;"><p style="margin:0 0 4px;font-size:12px;font-weight:bold;color:#4a4458;">${escapeHtml(block.note.title)}</p><p style="margin:0;font-size:14px;line-height:22px;color:#1d1b20;white-space:pre-wrap;">${escapeHtml(block.note.text)}</p></div>`
    : '';
  const footnote = block.footnote
    ? `<p style="margin:16px 0 0;padding:10px 12px;border-radius:8px;background:#fff7ed;font-size:13px;line-height:20px;color:#9a3412;">${escapeHtml(block.footnote)}</p>`
    : '';
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
${paragraphs}${note}${action}${footnote}
</td></tr></table></td></tr></table></body></html>`;
}

function message(to: string, subject: string, category: string, block: Block): EmailMessage {
  const text = [
    block.heading,
    '',
    ...block.paragraphs,
    ...(block.note ? ['', `${block.note.title}:`, block.note.text] : []),
    ...(block.action ? ['', `${block.action.label}: ${block.action.url}`] : []),
    ...(block.footnote ? ['', block.footnote] : []),
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

/**
 * "Temporarily rejected": the admin sends the application back with a reason and a single-use link to
 * the pre-filled onboarding form. The email states exactly when the link stops working.
 */
export function reuploadRequestedEmail(input: {
  to: string;
  fullName: string;
  reason: string;
  reuploadUrl: string;
  expiresAt: Date;
  ttlHours: number;
  timeZone?: string | null;
}): EmailMessage {
  const expires = formatExpiry(input.expiresAt, input.timeZone);
  return message(input.to, 'Action needed: update your Amentorz application', 'faculty-reupload', {
    heading: 'Please update your application',
    paragraphs: [
      `Hello ${input.fullName}, thank you for applying to teach on Amentorz.`,
      'Our team reviewed your application and needs a few changes before we can verify it. Your application is on hold until you send them.',
    ],
    note: { title: 'What to change', text: input.reason },
    action: { label: 'Update your application', url: input.reuploadUrl },
    footnote: `This link expires on ${expires} (${describeValidity(input.ttlHours)} after it was sent) and works once. If it expires, reply to this email and we will send a new one.`,
  });
}

export function reuploadReceivedEmail(input: {
  to: string;
  fullName: string;
  reference: string;
}): EmailMessage {
  return message(
    input.to,
    `Updated application received${input.reference ? ` (${input.reference})` : ''}`,
    'faculty-reupload-received',
    {
      heading: 'We have your updated application',
      paragraphs: [
        `Thanks, ${input.fullName}. Your updated application${input.reference ? ` ${input.reference}` : ''} has been submitted.`,
        'Operations reviews it again, usually within 3–5 working days. We will email you as your application progresses.',
      ],
    }
  );
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

export function subjectCardApprovedEmail(input: {
  to: string;
  fullName: string;
  subject: string;
  pathLabel: string;
  loginUrl: string;
}): EmailMessage {
  return message(input.to, 'Your new subject card is approved', 'faculty-subject-card-approved', {
    heading: 'Your subject card is approved',
    paragraphs: [
      `Hi ${input.fullName},`,
      `Your subject card ${input.subject} (${input.pathLabel}) is approved and priced.`,
      'Sign in to accept the session price. The card then appears in your library.',
    ],
    action: { label: 'Sign in', url: input.loginUrl },
  });
}

export function subjectCardRejectedEmail(input: {
  to: string;
  fullName: string;
  subject: string;
  pathLabel: string;
  reason: string;
}): EmailMessage {
  return message(input.to, 'Your subject card request', 'faculty-subject-card-rejected', {
    heading: 'Your subject card was not approved',
    paragraphs: [
      `Hi ${input.fullName},`,
      `We could not approve your request to teach ${input.subject} (${input.pathLabel}).`,
      'The card no longer counts towards your limit; you can request another subject from your profile.',
    ],
    note: { title: 'Reason', text: input.reason },
  });
}
