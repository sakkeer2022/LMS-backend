import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type TokenPayload } from '@core/security/jwt';
import { UnauthorizedError, ForbiddenError } from '@core/errors/index';
import { cookieName, requestPortal } from '@core/security/portal-cookies';
import { redisClient } from '@infrastructure/redis/connection';
import { evaluatePolicy, type PolicyRule } from '../core/security/policy.js';
import { hasPermission, roleInPortal } from '../core/security/rbac.js';
import { isSessionRevoked } from '../core/security/session-revocation.js';
import { loadLiveAccess } from '../core/security/live-access.js';
import { config } from '@config/index';

// Extend Express Request with the decoded JWT payload
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const portal = requestPortal(req);
  let token = req.cookies?.[cookieName('accessToken', portal)];

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return next(new UnauthorizedError('Missing or invalid Authorization token'));
  }

  try {
    const payload = verifyAccessToken(token);

    if (payload.jti && redisClient) {
      const isBlacklisted = await redisClient.get(`bl:${payload.jti}`);
      if (isBlacklisted) {
        return next(new UnauthorizedError('Access token has been revoked'));
      }
    }

    if (payload.sid && (await isSessionRevoked(payload.sid))) {
      return next(new UnauthorizedError('Session has been revoked'));
    }

    // A token from another portal never signs this portal in, whatever cookie it arrived in
    if (portal && payload.portal && payload.portal !== portal) {
      return next(new UnauthorizedError('Access token is invalid or expired'));
    }

    // Admin portal only: roles and permissions come from the database, never from the token, so a
    // deactivated user or a revoked permission blocks the very next request. Other portals are untouched.
    if (config.security.rbacLiveAdmin && payload.portal === 'admin') {
      const access = await loadLiveAccess(payload.sub);
      if (!access) return next(new UnauthorizedError('Account is not active'));
      payload.roles = access.roles;
      payload.permissions = access.permissions;
      payload.policies = access.policies;
      // A password an admin set is for the first sign-in only: until it is replaced, only the account's own
      // sign-in, password and profile (/admin/me) routes work
      if (access.mustChangePassword) {
        const path = req.originalUrl.split('?')[0] ?? '';
        if (!path.includes('/auth/') && !path.includes('/admin/me/'))
          return next(new ForbiddenError('Change your password to continue'));
      }
    }

    req.user = payload;
    next();
  } catch {
    next(new UnauthorizedError('Access token is invalid or expired'));
  }
}

/**
 * Require one or more roles on the authenticated user.
 * @deprecated Use requirePermission instead.
 * Usage: router.get('/admin', authenticate, requireRole('super_admin', 'admin'), handler)
 */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userRoles = req.user?.roles ?? [];
    const hasRole = roles.some((r) => userRoles.includes(r));
    if (!hasRole) {
      return next(new ForbiddenError(`Requires one of roles: ${roles.join(', ')}`));
    }
    next();
  };
}

/**
 * Require an admin-portal account: any role other than student or faculty (custom roles included).
 * For self-service admin routes that act only on the signed-in account and need no specific permission.
 */
export function requireAdminPortalUser(req: Request, _res: Response, next: NextFunction): void {
  const roles = req.user?.roles ?? [];
  if (!roles.some((r) => roleInPortal('admin', r)))
    return next(new ForbiddenError('Access denied'));
  next();
}

/**
 * Require a permission on the authenticated user.
 * Supports exact matches, wildcard matches (e.g. `user.*`), and ABAC policy conditions.
 * Usage: router.get('/users', authenticate, requirePermission('user.read'), handler)
 */
export function requirePermission(
  requiredPerm: string,
  resourceLoader?: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>
) {
  const guard = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      return next(new ForbiddenError('Access denied'));
    }

    if (!hasPermission(user.permissions ?? [], requiredPerm)) {
      return next(new ForbiddenError(`Requires permission: ${requiredPerm}`));
    }

    // Evaluate ABAC policy rules if they exist
    const userContext = user as unknown as Record<string, unknown>;
    const policies = (userContext.policies || []) as PolicyRule[];
    const parts = requiredPerm.split(/[.:]/);
    const subject = parts[0];
    const action = parts[1];

    const matchingPolicies = policies.filter((p) => {
      const matchSubject = p.subject === '*' || p.subject === subject;
      const matchAction = p.action === '*' || p.action === action;
      return matchSubject && matchAction;
    });

    const hasConditions = matchingPolicies.some(
      (p) => p.conditions && Object.keys(p.conditions).length > 0
    );

    if (hasConditions) {
      let resourceInstance =
        (req as Request & { resource?: Record<string, unknown> }).resource || {};
      if (resourceLoader) {
        try {
          resourceInstance = await resourceLoader(req);
        } catch (err) {
          return next(err);
        }
      }

      const isAuthorized = evaluatePolicy(userContext, resourceInstance, requiredPerm);
      if (!isAuthorized) {
        return next(new ForbiddenError(`Access denied by policy for: ${requiredPerm}`));
      }
    }

    next();
  };
  // Lets tests/unit/route-guards.test.ts see which routes carry a permission guard
  return Object.assign(guard, { permissionKey: requiredPerm });
}
