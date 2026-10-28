import { Request, Response, NextFunction } from 'express';
import { logAction } from '@modules/audit/audit.service.js';
import { logger } from '@core/logger/index.js';
import { generateDeviceFingerprint } from '@core/security/device.js';
import crypto from 'crypto';

export interface AuditOptions {
  action: string;
  resource: string;
  /** If true, the middleware will extract `req.params.id` as the resourceId */
  useParamsId?: boolean;
}

/**
 * Express middleware to automatically log an action to the audit logs.
 * Should be placed AFTER the `authenticate` middleware if you want the user to be logged.
 */
export function auditLog(options: AuditOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Hook into the response 'finish' event so we log the final result
    res.on('finish', () => {
      const details = {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
      };

      const resourceId = (options.useParamsId ? req.params['id'] : undefined) as string | undefined;

      const ip = req.ip ?? req.socket.remoteAddress;
      const ipAddress = (Array.isArray(ip) ? ip[0] : ip) as unknown as string;

      const ua = req.get('User-Agent');
      const userAgent = (Array.isArray(ua) ? ua[0] : ua) as unknown as string;

      const traceId = (req as unknown as { traceId?: string }).traceId || crypto.randomUUID();
      const correlationId = (req.headers['x-correlation-id'] as string) || traceId;
      const deviceFingerprint = generateDeviceFingerprint(req);

      let severity: 'INFO' | 'WARN' | 'SECURITY' | 'CRITICAL' = 'INFO';
      if (res.statusCode >= 500) {
        severity = 'CRITICAL';
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        severity = 'SECURITY';
      } else if (res.statusCode >= 400) {
        severity = 'WARN';
      }

      // We do this in a fire-and-forget manner to not block the response
      logAction({
        traceId,
        correlationId,
        actorId: req.user?.sub || null,
        ipAddress: ipAddress || '127.0.0.1',
        userAgent: userAgent || 'unknown',
        deviceFingerprint,
        severity,
        entity: options.resource,
        action: options.action,
        resourceId: resourceId || null,
        previousValue: null, // Diffs are populated in service mutations directly
        newValue: details,
      }).catch((err) => {
        logger.error('Failed to write audit log:', err);
      });
    });

    next();
  };
}

/**
 * Generic global audit middleware that guesses the resource and action from the HTTP method and path.
 */
export function auditLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    // Guess resource from URL (e.g. /api/v1/users/123 -> users)
    const pathParts = req.originalUrl.split('?')[0].split('/').filter(Boolean);
    const resource = pathParts.length > 2 ? pathParts[2] : 'unknown';

    let action = 'unknown';
    if (req.method === 'GET') action = 'read';
    if (req.method === 'POST') action = 'create';
    if (req.method === 'PUT' || req.method === 'PATCH') action = 'update';
    if (req.method === 'DELETE') action = 'delete';

    const details = {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
    };

    const ip = req.ip ?? req.socket.remoteAddress;
    const ipAddress = (Array.isArray(ip) ? ip[0] : ip) as unknown as string;

    const ua = req.get('User-Agent');
    const userAgent = (Array.isArray(ua) ? ua[0] : ua) as unknown as string;

    const traceId = (req as unknown as { traceId?: string }).traceId || crypto.randomUUID();
    const correlationId = (req.headers['x-correlation-id'] as string) || traceId;
    const deviceFingerprint = generateDeviceFingerprint(req);

    let severity: 'INFO' | 'WARN' | 'SECURITY' | 'CRITICAL' = 'INFO';
    if (res.statusCode >= 500) {
      severity = 'CRITICAL';
    } else if (res.statusCode === 401 || res.statusCode === 403) {
      severity = 'SECURITY';
    } else if (res.statusCode >= 400) {
      severity = 'WARN';
    }

    logAction({
      traceId,
      correlationId,
      actorId: req.user?.sub || null,
      ipAddress: ipAddress || '127.0.0.1',
      userAgent: userAgent || 'unknown',
      deviceFingerprint,
      severity,
      entity: resource,
      action,
      resourceId: undefined,
      previousValue: null,
      newValue: details,
    }).catch((err) => {
      logger.error('Failed to write audit log:', err);
    });
  });

  next();
}
