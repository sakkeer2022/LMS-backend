import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, NotFoundError, SystemError } from '@core/errors/index';
import { errorResponse } from '@core/response/index';
import { logger } from '@core/logger/index';
import { config } from '@config/index';

export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 1. Zod validation errors
  if (err instanceof ZodError) {
    const errors = err.issues.reduce<Record<string, string[]>>((acc, issue) => {
      const key = issue.path.join('.');
      acc[key] = [...(acc[key] ?? []), issue.message];
      return acc;
    }, {});

    const traceId = (req as unknown as { traceId?: string }).traceId;
    res.status(422).json(errorResponse('Validation failed', errors, traceId));
    return;
  }

  // 2. Centralized AppError handling
  if (err instanceof AppError) {
    const isSystemError = err instanceof SystemError || !err.isOperational;

    const logData = {
      type: isSystemError ? 'system_error' : 'operational_error',
      code: err.code,
      traceId: err.traceId,
      retryable: err.retryable,
      severity: err.severity,
      context: err.context,
      rootCause: err.rootCause?.message,
      err: {
        message: err.message,
        stack: err.stack,
      },
      req: {
        method: req.method,
        url: req.originalUrl,
        headers: {
          host: req.headers.host,
          'user-agent': req.headers['user-agent'],
        },
      },
    };

    if (err.severity === 'fatal' || err.severity === 'error') {
      logger.error(logData, err.message);
    } else if (err.severity === 'warn') {
      logger.warn(logData, err.message);
    } else {
      logger.info(logData, err.message);
    }

    // Format HTTP response
    const message =
      isSystemError && config.env === 'production' ? 'Internal server error' : err.message;

    res.status(err.statusCode).json(errorResponse(message, undefined, err.traceId));
    return;
  }

  // 3. Unknown / unexpected errors (standard JS errors not wrapped in AppError)
  const isDbError = err.name.startsWith('Sequelize') || err.name.startsWith('Prisma');
  const type = isDbError ? 'db_error' : 'unhandled_error';
  const traceId = (req as unknown as { traceId?: string }).traceId || 'system';

  logger.error(
    {
      type,
      err: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
      traceId,
      req: {
        method: req.method,
        url: req.originalUrl,
      },
    },
    err.message || 'Unhandled error'
  );

  const clientMsg =
    config.env === 'production'
      ? 'Internal server error'
      : err.message || 'An unexpected error occurred';

  res.status(500).json(errorResponse(clientMsg, undefined, traceId));
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
}
