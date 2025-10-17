/**
 * Prometheus metrics support for monitoring and observability
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";

export interface MetricsConfig {
  enabled: boolean;
}

let metricsEnabled = false;
let metricsRegistry: Registry | null = null;

// Metrics definitions
let queryDurationHistogram: Histogram<string> | null = null;
let errorCounter: Counter<string> | null = null;
let poolGauge: Gauge<string> | null = null;

/**
 * Initialize metrics registry and collectors
 */
export function initializeMetrics(config: MetricsConfig): void {
  if (!config.enabled) {
    return;
  }

  metricsEnabled = true;
  metricsRegistry = new Registry();

  // Query duration histogram
  queryDurationHistogram = new Histogram({
    name: "mcp_db_query_duration_seconds",
    help: "Duration of database queries in seconds",
    labelNames: ["tool", "db", "category"],
    buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [metricsRegistry],
  });

  // Error counter
  errorCounter = new Counter({
    name: "mcp_db_error_total",
    help: "Total number of database errors",
    labelNames: ["tool", "db", "error_type"],
    registers: [metricsRegistry],
  });

  // Pool connections gauge
  poolGauge = new Gauge({
    name: "mcp_db_pool_connections",
    help: "Number of active database pool connections",
    labelNames: ["db", "state"],
    registers: [metricsRegistry],
  });

  // Register default metrics (process CPU, memory, etc.)
  metricsRegistry.setDefaultLabels({
    app: "mcp-db",
  });

  // Collect default Node.js process metrics
  collectDefaultMetrics({
    register: metricsRegistry,
    prefix: "mcp_db_",
  });
}

/**
 * Record query duration metric
 */
export function recordQueryDuration(
  tool: string,
  db: string,
  category: string,
  durationSeconds: number
): void {
  if (metricsEnabled && queryDurationHistogram) {
    queryDurationHistogram.labels(tool, db, category).observe(durationSeconds);
  }
}

/**
 * Record error metric
 */
export function recordError(tool: string, db: string, errorType: string): void {
  if (metricsEnabled && errorCounter) {
    errorCounter.labels(tool, db, errorType).inc();
  }
}

/**
 * Set pool connection gauge
 */
export function setPoolConnections(db: string, state: "active" | "idle", count: number): void {
  if (metricsEnabled && poolGauge) {
    poolGauge.labels(db, state).set(count);
  }
}

/**
 * Get metrics in Prometheus text format
 */
export async function getMetrics(): Promise<string> {
  if (!metricsEnabled || !metricsRegistry) {
    return "";
  }
  return metricsRegistry.metrics();
}

/**
 * Check if metrics are enabled
 */
export function isMetricsEnabled(): boolean {
  return metricsEnabled;
}
