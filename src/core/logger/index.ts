import pino from 'pino';
import { config } from '@config/index';
import { getTraceId } from '@core/context/index';

export { sanitizeLogString } from './sanitize.js';

const REDACTED_PATHS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'cookie',
  'authorization',
  'apiKey',
  'clientSecret',
  'creditCard',
  'ssn',
  'birthDate',
];

export const logger = pino({
  level: config.log.level,
  redact: {
    paths: REDACTED_PATHS,
    censor: '[REDACTED]',
  },
  mixin() {
    const traceId = getTraceId();
    return traceId ? { traceId } : {};
  },
  ...(config.env === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
});

export type Logger = typeof logger;
