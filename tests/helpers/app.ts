import http from 'node:http';
import { beforeAll, afterAll } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { router } from '@routes/index.js';
import { globalErrorHandler } from '@middleware/errorHandler.js';
import { config } from '@config/index';
import { verifyCsrfToken } from '@middleware/csrf';

// Express app used by the integration tests, served on 127.0.0.1 (see below)
const expressApp = express();

expressApp.use(helmet());
expressApp.use(cors());
expressApp.use(express.json());
expressApp.use(cookieParser(config.security.cookieSecret));

expressApp.use('/api/v1', (req, res, next) => {
  if (req.path === '/auth/csrf-token') return next();
  verifyCsrfToken(req, res, next);
});

// Base api router
expressApp.use('/api/v1', router);

// Error handler
expressApp.use(globalErrorHandler);

// One server per test file, bound to 127.0.0.1. When supertest starts its own
// server per request it listens on all interfaces, and macOS can then hand out a
// port that another local app (IDE language servers and similar) holds on
// 127.0.0.1. The request reaches that app instead, failing with "socket hang up"
// or "Client sent an HTTP request to an HTTPS server".
const server = http.createServer(expressApp);
server.unref();

// Registered in every test file that imports this helper. Kept out of
// tests/setup.ts so that importing the app does not happen before a test
// file's vi.mock calls.
beforeAll(async () => {
  if (server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
});

afterAll(async () => {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

export { server as app };
