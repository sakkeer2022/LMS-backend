import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizeLogString } from '@core/logger/sanitize';

describe('sanitizeLogString', () => {
  it('passes through a normal ASCII string unchanged', () => {
    const input = 'Hello, World! 123';
    expect(sanitizeLogString(input)).toBe('Hello, World! 123');
  });

  it('replaces \\n with a space', () => {
    const input = 'line1\nline2';
    expect(sanitizeLogString(input)).toBe('line1 line2');
  });

  it('replaces \\r with a space', () => {
    const input = 'line1\rline2';
    expect(sanitizeLogString(input)).toBe('line1 line2');
  });

  it('replaces \\r\\n (CRLF) with a single space', () => {
    const input = 'line1\r\nline2';
    expect(sanitizeLogString(input)).toBe('line1 line2');
  });

  it('strips multiple consecutive CRLF sequences', () => {
    const input = 'a\r\nb\r\nc';
    expect(sanitizeLogString(input)).toBe('a b c');
  });

  it('strips null byte (0x00)', () => {
    const input = 'abc\x00def';
    expect(sanitizeLogString(input)).toBe('abcdef');
  });

  it('strips other C0 control characters (e.g. BEL \\x07, BS \\x08)', () => {
    const input = 'abc\x07def\x08ghi';
    expect(sanitizeLogString(input)).toBe('abcdefghi');
  });

  it('preserves horizontal tab (\\t)', () => {
    const input = 'col1\tcol2';
    expect(sanitizeLogString(input)).toBe('col1\tcol2');
  });

  it('preserves printable Unicode characters above 0x7E', () => {
    const input = 'user@example.com — résumé 日本語';
    expect(sanitizeLogString(input)).toBe('user@example.com — résumé 日本語');
  });

  it('sanitizes a simulated CRLF log-injection payload', () => {
    // Attacker tries to inject a fake log line via a header value
    const malicious = 'GET /legit\r\nFake-Header: injected-log-line';
    const result = sanitizeLogString(malicious);
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
    expect(result).toBe('GET /legit Fake-Header: injected-log-line');
  });

  it('handles an empty string', () => {
    expect(sanitizeLogString('')).toBe('');
  });
});
