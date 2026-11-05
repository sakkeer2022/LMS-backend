/**
 * The shared look of every Amentorz email: a wordmark, a heading, short paragraphs, an optional one-time code
 * and an optional button, and a footer. Inline styles and a table layout so it renders in common mail clients;
 * no images or remote resources, so nothing loads (or tracks) when the message is opened. Every value placed in
 * the HTML is escaped, so a template can pass user-visible text without extra care.
 */

export interface EmailBlock {
  /** Hidden preview line some clients show beside the subject */
  preheader?: string;
  heading: string;
  paragraphs: string[];
  /** A one-time code, shown large and spaced; also in the plain text */
  code?: string;
  action?: { label: string; url: string };
  /** Paragraphs after the code or button, such as how long it lasts and what to do if it was not asked for */
  closing?: string[];
  /** Small print under the card, for example why the person received this */
  footnote?: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);

// Amentorz purple and neutral greys, as in the portals' design tokens
const BRAND = '#8b3a96';
const INK = '#1d1b20';
const MUTED = '#4a4458';
const FINE = '#79747e';

const paragraphsHtml = (items: string[]): string =>
  items
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${MUTED};">${escapeHtml(p)}</p>`
    )
    .join('');

export function renderHtml(block: EmailBlock): string {
  const paragraphs = paragraphsHtml(block.paragraphs);
  const closing = paragraphsHtml(block.closing ?? []);
  const code = block.code
    ? `<p style="margin:8px 0 18px;padding:16px 12px;background:#f6eef7;border-radius:10px;text-align:center;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:32px;line-height:40px;font-weight:bold;letter-spacing:10px;color:${INK};">${escapeHtml(block.code)}</p>`
    : '';
  const action = block.action
    ? `<p style="margin:20px 0 4px;"><a href="${escapeHtml(block.action.url)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:13px 26px;border-radius:8px;">${escapeHtml(block.action.label)}</a></p>`
    : '';
  const preheader = block.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(block.preheader)}</div>`
    : '';
  const footnote = block.footnote
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:18px;color:${FINE};text-align:center;">${escapeHtml(block.footnote)}</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(block.heading)}</title>
</head>
<body style="margin:0;padding:32px 16px;background:#f4f4f6;font-family:Arial,Helvetica,sans-serif;color:${INK};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e4ea;border-radius:14px;">
<tr><td style="padding:0;height:6px;background:${BRAND};border-radius:14px 14px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 30px;">
<p style="margin:0 0 22px;font-size:20px;font-weight:bold;color:${BRAND};letter-spacing:0.3px;">Amentorz</p>
<h1 style="margin:0 0 14px;font-size:22px;line-height:30px;color:${INK};">${escapeHtml(block.heading)}</h1>
${paragraphs}${code}${action}${closing}
</td></tr></table>
${footnote}
</td></tr></table>
</body>
</html>`;
}

export function renderText(block: EmailBlock): string {
  return [
    block.heading,
    '',
    ...block.paragraphs.flatMap((p) => [p, '']),
    ...(block.code ? [`Your code: ${block.code}`, ''] : []),
    ...(block.action ? [`${block.action.label}: ${block.action.url}`, ''] : []),
    ...(block.closing ?? []).flatMap((p) => [p, '']),
    ...(block.footnote ? [block.footnote, ''] : []),
    'The Amentorz team',
  ].join('\n');
}
