import { getTraceId } from '@core/context/index';

export type ErrorSeverity = 'info' | 'warn' | 'error' | 'fatal';

export interface ErrorOptions {
  code?: string;
  retryable?: boolean;
  severity?: ErrorSeverity;
  context?: Record<string, unknown>;
  rootCause?: Error;
  /**
   * Per-field messages returned to the client in `errors` (operational errors only),
   * for example which emails in a batch conflict. Never put secrets here.
   */
  fieldErrors?: Record<string, string[]>;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code: string;
  public readonly traceId: string;
  public readonly retryable: boolean;
  public readonly severity: ErrorSeverity;
  public readonly context: Record<string, unknown>;
  public readonly rootCause?: Error;
  public readonly fieldErrors?: Record<string, string[]>;

  constructor(
    message: string,
    statusCode: number,
    isOperational: boolean,
    options: ErrorOptions = {}
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = options.code || 'INTERNAL_ERROR';
    this.traceId = getTraceId() || 'system';
    this.retryable = options.retryable ?? false;
    this.severity = options.severity ?? 'error';
    this.context = options.context ?? {};
    this.rootCause = options.rootCause;
    this.fieldErrors = options.fieldErrors;

    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

// OperationalError represents expected failures (e.g. client issues, 4xx)
export class OperationalError extends AppError {
  constructor(message: string, statusCode: number, options: ErrorOptions = {}) {
    super(message, statusCode, true, options);
  }
}

// SystemError represents unexpected failures (e.g. server bugs, DB down, 5xx)
export class SystemError extends AppError {
  constructor(message: string, statusCode: number, options: ErrorOptions = {}) {
    super(message, statusCode, false, {
      severity: 'error',
      ...options,
    });
  }
}

// --- Specific Operational Errors ---
export class NotFoundError extends OperationalError {
  constructor(resource = 'Resource', options?: ErrorOptions) {
    super(`${resource} not found`, 404, { code: 'NOT_FOUND', ...options });
  }
}

export class UnauthorizedError extends OperationalError {
  constructor(message = 'Unauthorized', options?: ErrorOptions) {
    super(message, 401, { code: 'UNAUTHORIZED', ...options });
  }
}

export class ForbiddenError extends OperationalError {
  constructor(message = 'Forbidden', options?: ErrorOptions) {
    super(message, 403, { code: 'FORBIDDEN', ...options });
  }
}

export class ValidationError extends OperationalError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 422, { code: 'VALIDATION_ERROR', ...options });
  }
}

export class ConflictError extends OperationalError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 409, { code: 'CONFLICT', ...options });
  }
}

export class BadRequestError extends OperationalError {
  constructor(message = 'Bad Request', options?: ErrorOptions) {
    super(message, 400, { code: 'BAD_REQUEST', ...options });
  }
}

export class TooManyRequestsError extends OperationalError {
  constructor(message = 'Too Many Requests', options?: ErrorOptions) {
    super(message, 429, {
      code: 'TOO_MANY_REQUESTS',
      retryable: true,
      severity: 'warn',
      ...options,
    });
  }
}

export class PayloadTooLargeError extends OperationalError {
  constructor(message = 'Payload Too Large', options?: ErrorOptions) {
    super(message, 413, { code: 'PAYLOAD_TOO_LARGE', ...options });
  }
}

export class BadGatewayError extends OperationalError {
  constructor(message = 'Bad Gateway', options?: ErrorOptions) {
    super(message, 502, { code: 'BAD_GATEWAY', retryable: true, ...options });
  }
}

// --- Specific System Errors ---
export class InternalServerError extends SystemError {
  constructor(message = 'Internal Server Error', options?: ErrorOptions) {
    super(message, 500, { code: 'INTERNAL_SERVER_ERROR', ...options });
  }
}

export class DatabaseError extends SystemError {
  constructor(message = 'Database operation failed', options?: ErrorOptions) {
    super(message, 500, { code: 'DATABASE_ERROR', ...options });
  }
}

export class QueueError extends SystemError {
  constructor(message = 'Queue operation failed', options?: ErrorOptions) {
    super(message, 500, { code: 'QUEUE_ERROR', ...options });
  }
}

export class ServiceUnavailableError extends SystemError {
  constructor(message = 'Service Unavailable', options?: ErrorOptions) {
    super(message, 503, { code: 'SERVICE_UNAVAILABLE', retryable: true, ...options });
  }
}

export class NotImplementedError extends SystemError {
  constructor(message = 'Not Implemented', options?: ErrorOptions) {
    super(message, 501, { code: 'NOT_IMPLEMENTED', ...options });
  }
}

export * from './result.js';
export * from './circuit-breaker.js';
