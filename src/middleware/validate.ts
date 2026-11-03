import { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';

export interface RequestValidationSchema {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
  /** Checked only (the request headers are left as they are): required headers and their shape */
  headers?: ZodType;
}

/**
 * Express 5 exposes `req.query` as a getter-only accessor on the request
 * prototype, so plain assignment throws in strict mode. Defining an own
 * property shadows the getter for the rest of this request only.
 */
function overrideRequestProperty(req: Request, key: 'query' | 'params', value: unknown): void {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

/**
 * Reusable Express middleware for declarative Zod request validation.
 * Validates request body, query parameters, and route parameters, and replaces
 * them with the parsed (coerced/defaulted) values.
 * Any ZodError is forwarded to centralized error handling (HTTP 422).
 */
export function validateRequest(schemas: RequestValidationSchema) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.headers) {
        await schemas.headers.parseAsync(req.headers);
      }
      if (schemas.params) {
        overrideRequestProperty(req, 'params', await schemas.params.parseAsync(req.params));
      }
      if (schemas.query) {
        overrideRequestProperty(req, 'query', await schemas.query.parseAsync(req.query));
      }
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
