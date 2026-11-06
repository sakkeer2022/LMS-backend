import { describe, expect, it } from 'vitest';
import { otpEmail, type OtpPurposeCopy } from '@infrastructure/email/index.js';
import { renderHtml, renderText } from '@infrastructure/email/layout.js';

const PURPOSES: OtpPurposeCopy[] = ['registration', 'recovery', 'password-change'];

describe('one-time code emails', () => {
  it.each(PURPOSES)('carries the code, the expiry and a branded layout for %s', (purpose) => {
    const mail = otpEmail(purpose, '482913', 10);
    expect(mail.subject).toMatch(/^Your Amentorz /);
    expect(mail.text).toContain('Your code: 482913');
    expect(mail.text).toContain('10 minutes');
    expect(mail.html).toContain('482913');
    expect(mail.html).toContain('Amentorz');
  });

  it('uses a different subject for each purpose', () => {
    const subjects = PURPOSES.map((p) => otpEmail(p, '111111', 10).subject);
    expect(new Set(subjects).size).toBe(PURPOSES.length);
  });

  it('loads nothing from outside: no images, scripts or remote styles', () => {
    const { html } = otpEmail('registration', '123456', 10);
    expect(html).not.toMatch(/<img|<script|<link|url\(/i);
  });
});

describe('email layout', () => {
  it('escapes every value placed in the HTML', () => {
    const html = renderHtml({
      heading: '<b>Hi</b>',
      paragraphs: ['a & b "c"'],
      code: '<1>',
      action: { label: '<go>', url: 'https://x.test/?a=1&b="2"' },
      footnote: "it's <fine>",
    });
    expect(html).not.toContain('<b>Hi</b>');
    expect(html).toContain('&lt;b&gt;Hi&lt;/b&gt;');
    expect(html).toContain('a &amp; b &quot;c&quot;');
    expect(html).toContain('href="https://x.test/?a=1&amp;b=&quot;2&quot;"');
  });

  it('keeps the plain text readable and complete', () => {
    const text = renderText({
      heading: 'Heading',
      paragraphs: ['One.', 'Two.'],
      code: '123456',
      action: { label: 'Open', url: 'https://x.test' },
      footnote: 'Why you got this.',
    });
    expect(text).toBe(
      [
        'Heading',
        '',
        'One.',
        '',
        'Two.',
        '',
        'Your code: 123456',
        '',
        'Open: https://x.test',
        '',
        'Why you got this.',
        '',
        'The Amentorz team',
      ].join('\n')
    );
  });
});
