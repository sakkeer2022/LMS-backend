/**
 * Sanitizes a string before it is written into a structured log field.
 *
 * Prevents CRLF log-injection attacks (OWASP CWE-117) by stripping
 * carriage-return (\r), line-feed (\n), and other non-printable ASCII
 * control characters from dynamic, user-controlled strings.
 *
 * Safe characters:
 *   - Printable ASCII (0x20–0x7E)
 *   - Horizontal tab (0x09) — preserved for readability
 *   - Printable Unicode above 0x7E — preserved
 *
 * @param value - The dynamic string to sanitize (e.g. req.ip, path segment, header value).
 * @returns A sanitized copy of the string with control characters removed.
 */
export function sanitizeLogString(value: string): string {
  return (
    value
      // Strip CR, LF, and CRLF sequences (log injection vectors)
      .replace(/\r\n|\r|\n/g, ' ')
      // Strip other C0 control characters (0x00–0x08, 0x0B–0x0C, 0x0E–0x1F)
      // preserving HT (0x09) and the printable range starting at 0x20.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  );
}
