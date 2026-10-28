import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { trace } from '@opentelemetry/api';

export interface RequestContext {
  traceId: string;
  spanId?: string;
  userId?: string;
}

export const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function getContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

export function getTraceId(): string | undefined {
  return getContext()?.traceId;
}

export function getSpanId(): string | undefined {
  return getContext()?.spanId;
}

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const traceId = (req.headers['x-request-id'] as string) || randomUUID();

  // Attach to the request object so pino-http can pick it up
  (req as unknown as { traceId: string }).traceId = traceId;

  // Read the active OTel span's spanId (populated by auto-instrumentation)
  const activeSpan = trace.getActiveSpan();
  const spanId = activeSpan?.spanContext().spanId;

  const requestContext: RequestContext = {
    traceId,
    ...(spanId ? { spanId } : {}),
  };

  asyncLocalStorage.run(requestContext, () => {
    next();
  });
}
