import express, { Application, Request, Response, NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import { getImplementedApiSpec, getDraftContractSpec } from './docs/swagger';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';

import { config } from '@config/index';
import { logger } from '@core/logger/index';
import { globalErrorHandler, notFoundHandler } from '@middleware/errorHandler';
import { TooManyRequestsError } from '@core/errors/index';
import { requestContextMiddleware } from '@core/context/index';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from './infrastructure/redis/connection';
import { router } from '@routes/index';
import { verifyCsrfToken } from '@middleware/csrf';
import {
  metricsRegistry,
  httpRequestsTotal,
  httpRequestDurationSeconds,
} from '@core/metrics/index';

export function createApp(): Application {
  const app = express();

  // ── Context ──────────────────────────────────────────────
  app.use(requestContextMiddleware);

  // ── Security ─────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles (e.g. for Swagger UI in dev)
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'https:', 'data:'],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      hsts: {
        maxAge: 63072000, // 2 years in seconds
        includeSubDomains: true,
        preload: true,
      },
      referrerPolicy: {
        policy: 'no-referrer-when-downgrade',
      },
    })
  );
  app.use(
    cors({
      // Explicit allowlist in every environment: browsers reject "*" for credentialed requests
      origin: config.security.allowedOrigins,
      credentials: true,
    })
  );
  app.use(
    rateLimit({
      store: redisClient
        ? new RedisStore({
            // @ts-expect-error - rate-limit-redis types differ slightly from ioredis
            sendCommand: (...args: string[]): unknown => redisClient?.call(...args),
          })
        : undefined, // Fallback to memory store when in test environment
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, _res, next) => {
        next(new TooManyRequestsError('Too many requests, please try again later.'));
      },
    })
  );

  // ── Request parsing ───────────────────────────────────────
  // Webhook verification requires raw request body buffer for HMAC signature validation
  app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  app.use(cookieParser(config.security.cookieSecret));

  // ── CSRF Protection ───────────────────────────────────────
  app.use('/api/v1', (req, res, next) => {
    if (req.path === '/auth/csrf-token') return next();
    if (req.path === '/payments/webhook') return next();
    verifyCsrfToken(req, res, next);
  });

  // ── HTTP request logging ──────────────────────────────────
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as unknown as { traceId: string }).traceId,
      customProps: () => ({ type: 'request' }),
    })
  );

  // ── HTTP Prometheus metrics middleware ────────────────────
  // Observes duration and increments counters on every response.
  // Path is normalised to avoid high-cardinality labels (no IDs).
  app.use((req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const durationSec = durationMs / 1000;

      // Normalise path: strip numeric/UUID segments to keep cardinality low
      const path = req.route?.path ?? req.path.replace(/\/[0-9a-f-]{8,}/gi, '/:id');
      const labels = { method: req.method, path, status: String(res.statusCode) };

      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, durationSec);
    });

    next();
  });

  // ── Health check ──────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      env: config.env,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Prometheus metrics endpoint ───────────────────────────
  // Protected by Bearer token in production (METRICS_TOKEN is required there); open in dev/test.
  app.get('/metrics', async (req: Request, res: Response): Promise<void> => {
    if (config.env === 'production') {
      const authHeader = req.headers['authorization'] ?? '';
      if (!config.metrics.token || authHeader !== `Bearer ${config.metrics.token}`) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }
    }

    try {
      const metrics = await metricsRegistry.metrics();
      res.setHeader('Content-Type', metricsRegistry.contentType);
      res.status(200).send(metrics);
    } catch (err) {
      logger.error({ err }, 'Failed to collect metrics');
      res.status(500).json({ success: false, message: 'Failed to collect metrics' });
    }
  });

  // ── API routes ────────────────────────────────────────────
  app.use(config.apiPrefix, router);

  // ── Swagger UI & OpenAPI Specification (Dev/Test only) ────
  // /api/docs           → implemented routes (JSDoc in *.routes.ts)
  // /api/docs/contract  → draft Sprint 1 contract (docs/openapi.yaml), not implemented
  if (config.env !== 'production') {
    const implementedSpec = getImplementedApiSpec();
    const contractSpec = getDraftContractSpec();

    app.get('/api/docs/spec', (_req, res) => {
      res.json(implementedSpec);
    });

    if (contractSpec) {
      app.get('/api/docs/contract/spec', (_req, res) => {
        res.json(contractSpec);
      });
      app.use(
        '/api/docs/contract',
        swaggerUi.serveFiles(contractSpec),
        swaggerUi.setup(contractSpec, {
          customSiteTitle: 'Amentorz API Docs — DRAFT Sprint 1 contract',
        })
      );
    }

    app.use(
      '/api/docs',
      swaggerUi.serveFiles(implementedSpec),
      swaggerUi.setup(implementedSpec, {
        customSiteTitle: 'Amentorz API Docs',
      })
    );
  }

  // ── 404 & global error handler ────────────────────────────
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}
