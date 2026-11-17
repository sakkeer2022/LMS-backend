import type { NextFunction, Request, Response } from 'express';
import { successResponse } from '@core/response/index';
import { ValidationError } from '@core/errors/index';
import { requestPortal } from '@core/security/portal-cookies';
import type { Portal } from '@core/security/rbac';
import { PortalLoginDto } from './auth.dto.js';
import { loginToPortal } from './portal-login.service.js';
import { getRequestContext, setTokenCookies } from './session-cookies.js';

export function portalLogin(portal: Portal) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const hinted = requestPortal(req);
      if (hinted && hinted !== portal) throw new ValidationError('Wrong portal for this login');
      const dto = PortalLoginDto.parse(req.body);
      const result = await loginToPortal(portal, dto, getRequestContext(req));

      setTokenCookies(
        res,
        result.tokens,
        { persistent: result.remember, expiresAt: result.sessionExpiresAt },
        hinted
      );
      res.json(
        successResponse(
          {
            user: result.user,
            accessExpiresAt: result.accessExpiresAt,
            sessionExpiresAt: result.sessionExpiresAt,
            requiresTermsAcceptance: result.requiresTermsAcceptance,
            requiresPasswordChange: result.requiresPasswordChange,
          },
          'Login successful'
        )
      );
    } catch (err) {
      next(err);
    }
  };
}
