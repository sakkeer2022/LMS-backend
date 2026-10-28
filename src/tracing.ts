/**
 * OpenTelemetry SDK bootstrap.
 *
 * IMPORTANT: This module MUST be imported as the very first import in
 * server.ts, before any other modules. Node.js require() hooks must be
 * installed before the instrumented modules are loaded.
 *
 * Instrumentation coverage (via auto-instrumentations-node):
 *  - Express (HTTP spans)
 *  - pg / @prisma/adapter-pg (DB spans)
 *  - ioredis (Redis spans)
 *  - http/https (outbound spans)
 *
 * Span export: OTLP HTTP to OTEL_EXPORTER_OTLP_ENDPOINT (default: http://localhost:4318).
 * Compatible with Jaeger, Grafana Tempo, or any OTLP-compatible collector.
 * If the collector is unreachable the exporter silently retries then drops spans.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';
import { config } from '@config/index';

const exporter = new OTLPTraceExporter({
  url: `${config.otel.endpoint}/v1/traces`,
});

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'rbac-backend',
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.env,
  }),
  traceExporter: exporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Reduce noise — disable fs instrumentation (very high cardinality)
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().catch((err: unknown) => {
    console.error('Error shutting down OTel SDK:', err);
  });
});
