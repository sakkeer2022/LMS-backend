/**
 * Centralized Prometheus metrics registry.
 *
 * All metric instruments for the RBAC backend are defined here.
 * Import individual instruments from this module; never instantiate
 * `prom-client` metrics elsewhere.
 *
 * Metrics exposed (as per Task 5 specification):
 *  - http_requests_total          (Counter)
 *  - http_request_duration_seconds (Histogram)
 *  - db_query_duration_seconds     (Histogram)
 *  - active_database_connections   (Gauge)
 *  - background_jobs_processed_total (Counter)
 *  - circuit_breaker_state         (Gauge)
 */
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();

// ── Default Node.js process metrics ──────────────────────────────────────────
// Collects: event loop lag, memory, CPU, GC, active handles, etc.
collectDefaultMetrics({ register: metricsRegistry });

// ── HTTP Metrics ──────────────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed',
  labelNames: ['method', 'path', 'status'] as const,
  registers: [metricsRegistry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

// ── Database Metrics ──────────────────────────────────────────────────────────

export const dbQueryDurationSeconds = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of Prisma/PostgreSQL queries in seconds',
  labelNames: [] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [metricsRegistry],
});

export const activeDatabaseConnections = new Gauge({
  name: 'active_database_connections',
  help: 'Number of active database connections in the pg pool',
  registers: [metricsRegistry],
});

// ── Queue Metrics ─────────────────────────────────────────────────────────────

export const backgroundJobsProcessedTotal = new Counter({
  name: 'background_jobs_processed_total',
  help: 'Total number of background jobs processed',
  labelNames: ['status', 'jobName'] as const,
  registers: [metricsRegistry],
});

// ── Circuit Breaker Metrics ───────────────────────────────────────────────────
// Values: 0 = closed (healthy), 1 = open (tripped), 2 = half-open (recovering)

export const circuitBreakerState = new Gauge({
  name: 'circuit_breaker_state',
  help: 'State of circuit breakers (0=closed, 1=open, 2=half-open)',
  labelNames: ['name'] as const,
  registers: [metricsRegistry],
});
