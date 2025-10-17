#!/usr/bin/env node

const args = process.argv.slice(2);

export {};

interface ParsedOptions {
  [key: string]: string | boolean;
}

const options: ParsedOptions = {};

function setOption(key: string, value: string | boolean): void {
  options[key] = value;
}

function parseArgs(): void {
  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index];
    if (!raw.startsWith("--")) {
      continue;
    }
    const withoutPrefix = raw.slice(2);
    if (withoutPrefix === "help" || withoutPrefix === "h") {
      setOption("help", true);
      continue;
    }
    const equalIndex = withoutPrefix.indexOf("=");
    if (equalIndex !== -1) {
      const key = withoutPrefix.slice(0, equalIndex);
      const value = withoutPrefix.slice(equalIndex + 1);
      setOption(key, value);
      continue;
    }
    const key = withoutPrefix;
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      setOption(key, next);
      index += 1;
    } else {
      setOption(key, true);
    }
  }
}

function toBoolean(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (["1", "true", "yes", "on"].includes(lowered)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(lowered)) {
      return false;
    }
  }
  return undefined;
}

function showHelp(): void {
  const message = `Usage: npx @amusphere/mcp-db [options]\n\n` +
    `Options:\n` +
    `  --db-url <url>           Override the database URL (alias: --host)\n` +
    `  --port <number>          Port to listen on (default: 8080)\n` +
    `  --max-rows <number>      Maximum rows to return for read queries\n` +
    `  --timeout <seconds>      Query timeout in seconds\n` +
    `  --allow-writes [bool]    Enable write queries (requires true)\n` +
    `  --allow-ddl [bool]       Enable DDL statements (requires true)\n` +
    `  --allowlist <items>      Comma-separated allowlist of schema.table\n` +
    `  --require-api-key [bool] Require X-API-Key header\n` +
    `  --api-key <value>        Expected API key when required\n` +
    `  --help                   Show this message\n`;
  console.log(message);
}

parseArgs();

if (options.help) {
  showHelp();
  process.exit(0);
}

const dbUrl = (options["db-url"] || options.host) as string | undefined;
if (dbUrl) {
  process.env.DB_URL = dbUrl;
}

const portValue = options.port as string | undefined;
if (portValue) {
  process.env.PORT = portValue;
}

const maxRowsValue = options["max-rows"] as string | undefined;
if (maxRowsValue) {
  process.env.MAX_ROWS = maxRowsValue;
}

const timeoutValue = options.timeout as string | undefined;
if (timeoutValue) {
  process.env.QUERY_TIMEOUT_SEC = timeoutValue;
}

const allowWrites = toBoolean(options["allow-writes"]);
if (allowWrites !== undefined) {
  process.env.ALLOW_WRITES = String(allowWrites);
}

const allowDdl = toBoolean(options["allow-ddl"]);
if (allowDdl !== undefined) {
  process.env.ALLOW_DDL = String(allowDdl);
}

const allowlist = options.allowlist as string | undefined;
if (allowlist) {
  process.env.ALLOWLIST_TABLES = allowlist;
}

const requireApiKey = toBoolean(options["require-api-key"]);
if (requireApiKey !== undefined) {
  process.env.REQUIRE_API_KEY = String(requireApiKey);
}

const apiKeyValue = options["api-key"] as string | undefined;
if (apiKeyValue) {
  process.env.API_KEY = apiKeyValue;
}

await import("./index.js");
