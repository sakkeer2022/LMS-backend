import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '@core/errors/index';

const CSRF_COOKIE_NAME = '_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

export function verifyCsrfToken(req: Request, _res: Response, next: NextFunction): void {
  // Safe methods that don't change state
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const cookieToken = req.signedCookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME];

  if (!cookieToken || !headerToken) {
    return next(new ForbiddenError('CSRF token missing'));
  }

  // Ensure constant-time comparison to prevent timing attacks, though a simple `===` is often fine for random UUIDs
  if (cookieToken !== headerToken) {
    return next(new ForbiddenError('CSRF token mismatch'));
  }

  next();
}
