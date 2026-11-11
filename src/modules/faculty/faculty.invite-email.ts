import type { EmailMessage } from '@infrastructure/email/index';

export interface InvitationEmailInput {
  to: string;
  inviteUrl: string;
  expiresAt: Date;
  ttlHours: number;
  /** IANA zone to state the expiry in; UTC when the recipient's zone is not known yet. */
  timeZone?: string | null;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] as string);
}

/** "72 hours", "1 hour", "3 days". */
export function describeValidity(ttlHours: number): string {
  if (ttlHours % 24 === 0) {
    const days = ttlHours / 24;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${ttlHours} hour${ttlHours === 1 ? '' : 's'}`;
}

/**
 * The exact moment a link stops working, for an email: "Saturday, 14 November 2026, 10:30 AM UTC".
 * The zone is the recipient's when known (a tutor's account time zone); an invitee has no account yet,
 * so their invitation states UTC. No zone is assumed from a country here (see src/docs/REGIONS.md).
 */
export function formatExpiry(date: Date, timeZone?: string | null): string {
  const zone = timeZone || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: zone,
      timeZoneName: 'short',
    })
      .format(date)
      .replace(' at ', ', ')
      .replace(/\b(am|pm)\b/, (m) => m.toUpperCase());
  } catch {
    // An unknown zone name: fall back to UTC rather than fail the email
    return formatExpiry(date, 'UTC');
  }
}

/**
 * Invitation email with one onboarding call to action. Inline styles and a table
 * layout so it renders in common mail clients. The link is the only personalised
 * content; nothing the admin types is placed in the body.
 */
export function buildInvitationEmail(input: InvitationEmailInput): EmailMessage {
  const validity = describeValidity(input.ttlHours);
  const expires = formatExpiry(input.expiresAt, input.timeZone);
  const href = escapeHtml(input.inviteUrl);
  const subject = 'You are invited to teach on Amentorz';

  const text = [
    'Hello,',
    '',
    'You have been invited to join Amentorz as a tutor.',
    'Open the link below to set up your account and complete your tutor profile:',
    '',
    input.inviteUrl,
    '',
    `This link works once and expires on ${expires} (${validity} after it was sent).`,
    'If you were not expecting this invitation, you can ignore this email.',
    '',
    'The Amentorz team',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f6;font-family:Arial,Helvetica,sans-serif;color:#1d1b20;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e4ea;border-radius:12px;">
<tr><td style="padding:28px 32px 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:28px;height:28px;background:#8b3a96;border-radius:6px;color:#ffffff;font-weight:bold;font-size:14px;text-align:center;">A</td>
<td style="padding-left:10px;font-size:18px;font-weight:bold;">Amentorz</td>
</tr></table>
</td></tr>
<tr><td style="padding:24px 32px 0;">
<h1 style="margin:0 0 12px;font-size:20px;line-height:28px;">You're invited to teach on Amentorz</h1>
<p style="margin:0 0 12px;font-size:14px;line-height:22px;color:#4a4458;">You have been invited to join Amentorz as a tutor. Set up your account and complete your tutor profile to get started.</p>
</td></tr>
<tr><td style="padding:12px 32px 8px;">
<a href="${href}" style="display:inline-block;background:#8b3a96;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 22px;border-radius:8px;">Complete your profile</a>
</td></tr>
<tr><td style="padding:16px 32px 0;">
<p style="margin:0 0 8px;font-size:12px;line-height:18px;color:#6b6478;">Or copy this link into your browser:</p>
<p style="margin:0;font-size:12px;line-height:18px;word-break:break-all;"><a href="${href}" style="color:#8b3a96;">${href}</a></p>
</td></tr>
<tr><td style="padding:20px 32px 0;">
<p style="margin:0;padding:10px 12px;border-radius:8px;background:#fff7ed;font-size:13px;line-height:20px;color:#9a3412;"><strong>Link expires on ${escapeHtml(expires)}</strong><br>It works once and is valid for ${escapeHtml(validity)} after it was sent.</p>
</td></tr>
<tr><td style="padding:16px 32px 28px;">
<p style="margin:0;font-size:12px;line-height:18px;color:#6b6478;">If you were not expecting this invitation, you can ignore this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { to: input.to, subject, html, text, category: 'faculty-invitation' };
}
