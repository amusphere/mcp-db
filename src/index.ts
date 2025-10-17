#!/usr/bin/env node

/**
 * MCP Database Server - Entry point
 * Supports both MCP stdio protocol and optional HTTP server mode
 */

import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    host: { type: "string" },
    "db-url": { type: "string" },
    port: { type: "string" },
    "max-rows": { type: "string" },
    timeout: { type: "string" },
    "allow-writes": { type: "boolean" },
    "allow-ddl": { type: "boolean" },
    allowlist: { type: "string" },
    "require-api-key": { type: "boolean" },
    "api-key": { type: "string" },
    "http-mode": { type: "boolean" },
    metrics: { type: "boolean" },
  },
  allowPositionals: true,
});

function showHelp(): void {
  const message = `Usage: npx @amusphere/mcp-db [options]\n\n` +
    `MCP Database Server - Query databases via Model Context Protocol\n\n` +
    `Options:\n` +
    `  --host <url>             Database URL (alias: --db-url)\n` +
    `                           Examples:\n` +
    `                             sqlite:///./dev.db\n` +
    `                             postgresql://user:pass@localhost/dbname\n` +
    `  --port <number>          Port for HTTP mode (default: 8080)\n` +
    `  --max-rows <number>      Maximum rows to return for read queries\n` +
    `  --timeout <seconds>      Query timeout in seconds\n` +
    `  --allow-writes           Enable write queries (INSERT/UPDATE/DELETE)\n` +
    `  --allow-ddl              Enable DDL statements (CREATE/ALTER/DROP)\n` +
    `  --allowlist <items>      Comma-separated allowlist of schema.table\n` +
    `  --require-api-key        Require X-API-Key header (HTTP mode only)\n` +
    `  --api-key <value>        Expected API key when required\n` +
    `  --http-mode              Run as HTTP server instead of MCP stdio\n` +
    `  --metrics                Enable Prometheus metrics endpoint (HTTP mode only)\n` +
    `  --help, -h               Show this message\n\n` +
    `Environment Variables:\n` +
    `  DB_URL, ALLOW_WRITES, ALLOW_DDL, ALLOWLIST_TABLES, METRICS_ENABLED, etc.\n` +
    `  (Command-line options override environment variables)\n\n` +
    `Examples:\n` +
    `  # MCP stdio mode (default):\n` +
    `  npx @amusphere/mcp-db --host sqlite:///./dev.db\n\n` +
    `  # HTTP server mode with metrics:\n` +
    `  npx @amusphere/mcp-db --host sqlite:///./dev.db --http-mode --metrics\n`;
  console.log(message);
}

if (values.help) {
  showHelp();
  process.exit(0);
}

// Set environment variables from CLI arguments
const dbUrl = values["db-url"] ?? values.host;
if (dbUrl) {
  process.env.DB_URL = dbUrl;
}

if (values.port) {
  process.env.PORT = values.port;
}

if (values["max-rows"]) {
  process.env.MAX_ROWS = values["max-rows"];
}

if (values.timeout) {
  process.env.QUERY_TIMEOUT_SEC = values.timeout;
}

if (values["allow-writes"] !== undefined) {
  process.env.ALLOW_WRITES = String(values["allow-writes"]);
}

if (values["allow-ddl"] !== undefined) {
  process.env.ALLOW_DDL = String(values["allow-ddl"]);
}

if (values.allowlist) {
  process.env.ALLOWLIST_TABLES = values.allowlist;
}

if (values["require-api-key"] !== undefined) {
  process.env.REQUIRE_API_KEY = String(values["require-api-key"]);
}

if (values["api-key"]) {
  process.env.API_KEY = values["api-key"];
}

if (values.metrics !== undefined) {
  process.env.METRICS_ENABLED = String(values.metrics);
}

// Run in HTTP mode or MCP stdio mode
if (values["http-mode"]) {
  await import("./http-server.js");
} else {
  await import("./mcp-server.js");
}
