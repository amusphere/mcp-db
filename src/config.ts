import dotenv from "dotenv";

dotenv.config();

export interface Settings {
  dbUrl: string;
  maxRows: number;
  queryTimeoutMs: number;
  allowWrites: boolean;
  allowDdl: boolean;
  allowlistTables: string[];
  requireApiKey: boolean;
  apiKey: string;
  metricsEnabled: boolean;
}

let cachedSettings: Settings | null = null;

function toBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const normalized = value.toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parseAllowlist(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function getSettings(): Settings {
  if (cachedSettings) {
    return cachedSettings;
  }

  const maxRows = Number(process.env.MAX_ROWS ?? "500");
  const timeoutSec = Number(process.env.QUERY_TIMEOUT_SEC ?? "20");

  cachedSettings = {
    dbUrl: process.env.DB_URL ?? "sqlite:///./dev.db",
    maxRows: Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : 500,
    queryTimeoutMs:
      Number.isFinite(timeoutSec) && timeoutSec > 0
        ? Math.floor(timeoutSec * 1000)
        : 20000,
    allowWrites: toBoolean(process.env.ALLOW_WRITES, false),
    allowDdl: toBoolean(process.env.ALLOW_DDL, false),
    allowlistTables: parseAllowlist(process.env.ALLOWLIST_TABLES),
    requireApiKey: toBoolean(process.env.REQUIRE_API_KEY, false),
    apiKey: process.env.API_KEY ?? "",
    metricsEnabled: toBoolean(process.env.METRICS_ENABLED, false),
  };

  return cachedSettings;
}
