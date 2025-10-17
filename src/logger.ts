/**
 * Structured logging utility with trace context support
 * Logs to stderr in JSON format for observability
 */

import { randomBytes } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  trace_id?: string;
  span_id?: string;
  tool?: string;
  db?: string;
  duration_ms?: number;
  rows?: number;
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  trace_id?: string;
  span_id?: string;
  [key: string]: unknown;
}

/**
 * Generate a random trace ID
 */
export function generateTraceId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Generate a random span ID
 */
export function generateSpanId(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Log a structured message to stderr
 */
export function log(level: LogLevel, message: string, context?: LogContext): void {
  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...context,
  };

  // Write to stderr to avoid interfering with MCP protocol on stdout
  console.error(JSON.stringify(entry));
}

/**
 * Log helper functions
 */
export const logger = {
  debug: (message: string, context?: LogContext) => log("debug", message, context),
  info: (message: string, context?: LogContext) => log("info", message, context),
  warn: (message: string, context?: LogContext) => log("warn", message, context),
  error: (message: string, context?: LogContext) => log("error", message, context),
};
