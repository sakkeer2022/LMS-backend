import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type TokenPayload } from '@core/security/jwt';
import { UnauthorizedError, ForbiddenError } from '@core/errors/index';
import { redisClient } from '@infrastructure/redis/connection';
import { evaluatePolicy, type PolicyRule } from '../core/security/policy.js';

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
  let token = req.cookies?.accessToken;

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
 * Require a permission on the authenticated user.
 * Supports exact matches, wildcard matches (e.g. `user.*`), and ABAC policy conditions.
 * Usage: router.get('/users', authenticate, requirePermission('user.read'), handler)
 */
export function requirePermission(
  requiredPerm: string,
  resourceLoader?: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      return next(new ForbiddenError('Access denied'));
    }

    const userPermissions = user.permissions ?? [];

    const hasBasePermission = userPermissions.some((userPerm) => {
      // Global admin wildcard
      if (userPerm === '*' || userPerm === 'admin.*') return true;
      // Exact match
      if (userPerm === requiredPerm) return true;

      // Resource wildcard match (e.g. user.* matches user.read)
      const [reqResource] = requiredPerm.split(/[.:]/);
      const [uResource, uAction] = userPerm.split(/[.:]/);
      if (uResource === reqResource && (uAction === '*' || uAction === 'manage')) return true;

      return false;
    });

    if (!hasBasePermission) {
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
}
