/**
 * Unit tests for the Prometheus metrics registry (src/core/metrics/index.ts).
 *
 * These tests verify:
 *  1. All required metric instruments are registered with the correct names.
 *  2. Counters increment correctly.
 *  3. Histograms record observations correctly.
 *  4. Gauges set values correctly.
 *  5. The /metrics text output contains the expected metric names.
 *
 * NOTE: No HTTP server, no database — pure unit tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Import instruments and registry under test
import {
  metricsRegistry,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  dbQueryDurationSeconds,
  activeDatabaseConnections,
  backgroundJobsProcessedTotal,
  circuitBreakerState,
} from '@core/metrics/index';

// Helper: collect all current metric output as text
async function getMetricText(): Promise<string> {
  return metricsRegistry.metrics();
}

describe('Metrics Registry', () => {
  it('registers all required metric names', async () => {
    const metrics = await getMetricText();
    expect(metrics).toContain('http_requests_total');
    expect(metrics).toContain('http_request_duration_seconds');
    expect(metrics).toContain('db_query_duration_seconds');
    expect(metrics).toContain('active_database_connections');
    expect(metrics).toContain('background_jobs_processed_total');
    expect(metrics).toContain('circuit_breaker_state');
  });

  it('includes default Node.js process metrics', async () => {
    const metrics = await getMetricText();
    // These are always present from collectDefaultMetrics()
    expect(metrics).toContain('nodejs_heap_size_used_bytes');
    expect(metrics).toContain('process_cpu_seconds_total');
  });
});

describe('httpRequestsTotal', () => {
  it('increments the counter and appears in output', async () => {
    httpRequestsTotal.inc({ method: 'GET', path: '/test', status: '200' });

    const metrics = await getMetricText();
    expect(metrics).toContain('http_requests_total');
    expect(metrics).toContain('method="GET"');
    expect(metrics).toContain('path="/test"');
    expect(metrics).toContain('status="200"');
  });
});

describe('httpRequestDurationSeconds', () => {
  it('records an observation and creates histogram buckets', async () => {
    httpRequestDurationSeconds.observe({ method: 'POST', path: '/api/v1/auth/login', status: '200' }, 0.042);

    const metrics = await getMetricText();
    expect(metrics).toContain('http_request_duration_seconds_bucket');
    expect(metrics).toContain('http_request_duration_seconds_sum');
    expect(metrics).toContain('http_request_duration_seconds_count');
  });
});

describe('dbQueryDurationSeconds', () => {
  it('records a DB query observation', async () => {
    dbQueryDurationSeconds.observe(0.012);

    const metrics = await getMetricText();
    expect(metrics).toContain('db_query_duration_seconds_bucket');
    expect(metrics).toContain('db_query_duration_seconds_sum');
  });
});

describe('activeDatabaseConnections', () => {
  it('sets and reflects the gauge value', async () => {
    activeDatabaseConnections.set(7);

    const metrics = await getMetricText();
    expect(metrics).toContain('active_database_connections 7');
  });
});

describe('backgroundJobsProcessedTotal', () => {
  it('increments with completed status', async () => {
    backgroundJobsProcessedTotal.inc({ status: 'completed', jobName: 'generate-embeddings' });

    const metrics = await getMetricText();
    expect(metrics).toContain('background_jobs_processed_total');
    expect(metrics).toContain('status="completed"');
    expect(metrics).toContain('jobName="generate-embeddings"');
  });

  it('increments with failed status', async () => {
    backgroundJobsProcessedTotal.inc({ status: 'failed', jobName: 'process-billing' });

    const metrics = await getMetricText();
    expect(metrics).toContain('status="failed"');
    expect(metrics).toContain('jobName="process-billing"');
  });
});

describe('circuitBreakerState', () => {
  it('sets the circuit breaker state gauge', async () => {
    circuitBreakerState.set({ name: 'payment-gateway' }, 1); // 1 = open

    const metrics = await getMetricText();
    expect(metrics).toContain('circuit_breaker_state');
    expect(metrics).toContain('name="payment-gateway"');
  });
});
