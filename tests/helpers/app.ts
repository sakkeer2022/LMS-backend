import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { router } from '@routes/index.js';
import { globalErrorHandler } from '@middleware/errorHandler.js';
import { config } from '@config/index';
import { verifyCsrfToken } from '@middleware/csrf';

// Helper to create an express app without starting the server, useful for Supertest
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(cookieParser(config.security.cookieSecret));

app.use('/api/v1', (req, res, next) => {
  if (req.path === '/auth/csrf-token') return next();
  verifyCsrfToken(req, res, next);
});

// Base api router
app.use('/api/v1', router);

// Error handler
app.use(globalErrorHandler);

export { app };
