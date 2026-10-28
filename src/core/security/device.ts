import crypto from 'crypto';
import { Request } from 'express';

export function generateDeviceFingerprint(req: Request): string {
  const userAgent = req.headers['user-agent'] || 'unknown-agent';
  const acceptLanguage = req.headers['accept-language'] || 'unknown-lang';
  const acceptEncoding = req.headers['accept-encoding'] || 'unknown-encoding';

  // We exclude IP from the device fingerprint hash to avoid session termination on standard ISP IP rotations,
  // but we still capture IP separately in the active session database schema.
  return crypto
    .createHash('sha256')
    .update(`${userAgent}|${acceptLanguage}|${acceptEncoding}`)
    .digest('hex');
}
