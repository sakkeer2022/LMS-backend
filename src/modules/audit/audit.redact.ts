const SENSITIVE_KEY =
  /pass|otp|token|secret|hash|fingerprint|agent|ipaddress|email|mobile|phone|birth|signature|document/i;
const MAX_DEPTH = 5;

// shortcut: a deny-list on key names, so a new sensitive key with an unusual name would pass; move to an allowlist once the audited actions settle.
/** Copy of an audit value that is safe to return: sensitive keys hidden, URL query strings and deep nesting dropped. */
export function redact(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (depth > MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => redact(item, key, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k, depth + 1)]));
  }
  return key === 'url' && typeof value === 'string' ? value.split('?')[0] : value;
}
