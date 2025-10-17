import { Pool, PoolClient } from "pg";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";

export type Driver = "postgres" | "sqlite";

export interface NormalizedDatabaseConfig {
  driver: Driver;
  key: string;
  connectionString: string;
  sqlitePath?: string;
}

sqlite3.verbose();

const postgresPools = new Map<string, Pool>();
const sqliteDbs = new Map<string, Promise<Database<sqlite3.Database, sqlite3.Statement>>>();

export class DatabaseError extends Error {}

export function normalizeDatabaseUrl(rawUrl: string): NormalizedDatabaseConfig {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new DatabaseError("Database URL must not be empty");
  }

  let normalized = trimmed;
  if (normalized.startsWith("postgresql+asyncpg://")) {
    normalized = "postgresql://" + normalized.slice("postgresql+asyncpg://".length);
  } else if (normalized.startsWith("postgres+asyncpg://")) {
    normalized = "postgresql://" + normalized.slice("postgres+asyncpg://".length);
  } else if (normalized.startsWith("postgres://")) {
    normalized = "postgresql://" + normalized.slice("postgres://".length);
  }

  if (normalized.startsWith("postgresql://")) {
    return {
      driver: "postgres",
      key: normalized,
      connectionString: normalized,
    };
  }

  if (normalized.startsWith("sqlite+aiosqlite://")) {
    normalized = "sqlite://" + normalized.slice("sqlite+aiosqlite://".length);
  }

  if (normalized.startsWith("sqlite://")) {
    const path = extractSqlitePath(normalized);
    if (!path) {
      throw new DatabaseError("SQLite connection string must include a path or :memory:");
    }
    return {
      driver: "sqlite",
      key: path,
      connectionString: normalized,
      sqlitePath: path,
    };
  }

  throw new DatabaseError(`Unsupported database URL: ${rawUrl}`);
}

function extractSqlitePath(url: string): string | null {
  if (url === "sqlite::memory:" || url === "sqlite:///:memory:" || url === "sqlite://memory") {
    return ":memory:";
  }

  if (url.startsWith("sqlite:///")) {
    const path = url.slice("sqlite:///".length);
    return decodeURIComponent(path) || null;
  }

  if (url.startsWith("sqlite://")) {
    const remainder = url.slice("sqlite://".length);
    if (remainder.startsWith("/")) {
      return decodeURIComponent(remainder);
    }
    return decodeURIComponent(remainder) || null;
  }

  return null;
}

function getPostgresPool(connectionString: string): Pool {
  const existing = postgresPools.get(connectionString);
  if (existing) {
    return existing;
  }
  const pool = new Pool({ connectionString });
  postgresPools.set(connectionString, pool);
  return pool;
}

async function getSqliteDatabase(path: string): Promise<Database<sqlite3.Database, sqlite3.Statement>> {
  const existing = sqliteDbs.get(path);
  if (existing) {
    return existing;
  }
  const dbPromise = open({ filename: path, driver: sqlite3.Database });
  sqliteDbs.set(path, dbPromise);
  return dbPromise;
}

export async function listTables(config: NormalizedDatabaseConfig, schema?: string): Promise<string[]> {
  if (config.driver === "postgres") {
    const pool = getPostgresPool(config.connectionString);
    const client = await pool.connect();
    try {
      let text =
        "SELECT table_schema, table_name FROM information_schema.tables " +
        "WHERE table_type IN ('BASE TABLE', 'VIEW') " +
        "AND table_schema NOT IN ('pg_catalog', 'information_schema')";
      const values: unknown[] = [];
      if (schema) {
        text += " AND table_schema = $1";
        values.push(schema);
      }
      text += " ORDER BY table_schema, table_name";
      const result = await client.query<{ table_schema: string; table_name: string }>({ text, values });
      return result.rows.map((row) => `${row.table_schema}.${row.table_name}`);
    } catch (error) {
      throw new DatabaseError((error as Error).message);
    } finally {
      client.release();
    }
  }

  if (config.driver === "sqlite") {
    const db = await getSqliteDatabase(config.sqlitePath!);
    try {
      const rows = (await db.all(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )) as Array<{ name: string }>;
      return rows.map((row) => row.name);
    } catch (error) {
      throw new DatabaseError((error as Error).message);
    }
  }

  throw new DatabaseError("Unsupported database driver");
}

function splitTableIdentifier(table: string, schema?: string): { schema: string | undefined; table: string } {
  if (table.includes(".")) {
    const [schemaPart, tablePart] = table.split(".", 2);
    return { schema: schemaPart, table: tablePart };
  }
  return { schema, table };
}

export interface ColumnDescription {
  column_name: string;
  data_type: string;
  is_nullable: boolean;
}

export async function describeTable(
  config: NormalizedDatabaseConfig,
  table: string,
  schema?: string
): Promise<ColumnDescription[]> {
  if (config.driver === "postgres") {
    const { schema: resolvedSchema, table: resolvedTable } = splitTableIdentifier(table, schema);
    const schemaName = resolvedSchema ?? "public";
    const pool = getPostgresPool(config.connectionString);
    const client = await pool.connect();
    try {
      const query = {
        text:
          "SELECT column_name, data_type, is_nullable FROM information_schema.columns " +
          "WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        values: [schemaName, resolvedTable],
      };
      const result = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(query);
      return result.rows.map((row) => ({
        column_name: row.column_name,
        data_type: row.data_type,
        is_nullable: row.is_nullable === "YES",
      }));
    } catch (error) {
      throw new DatabaseError((error as Error).message);
    } finally {
      client.release();
    }
  }

  if (config.driver === "sqlite") {
    const { table: resolvedTable } = splitTableIdentifier(table, schema);
    const db = await getSqliteDatabase(config.sqlitePath!);
    try {
      const rows = (await db.all(
        `PRAGMA table_info('${resolvedTable.replace(/'/g, "''")}')`
      )) as Array<{ name: string; type: string; notnull: number }>;
      return rows.map((row) => ({
        column_name: row.name,
        data_type: row.type,
        is_nullable: row.notnull === 0,
      }));
    } catch (error) {
      throw new DatabaseError((error as Error).message);
    }
  }

  throw new DatabaseError("Unsupported database driver");
}

export interface ExecuteResultRead {
  rows: Record<string, unknown>[];
  truncated: boolean;
}

export interface ExecuteResultWrite {
  rowcount: number;
}

export async function executeSql(
  config: NormalizedDatabaseConfig,
  sql: string,
  args: Record<string, unknown> | undefined,
  expectResult: boolean,
  limit: number
): Promise<ExecuteResultRead | ExecuteResultWrite> {
  if (config.driver === "postgres") {
    return executePostgres(config.connectionString, sql, args, expectResult, limit);
  }
  if (config.driver === "sqlite") {
    return executeSqlite(config.sqlitePath!, sql, args, expectResult, limit);
  }
  throw new DatabaseError("Unsupported database driver");
}

function bindPostgresParameters(
  sql: string,
  args: Record<string, unknown> | undefined
): { text: string; values: unknown[] } {
  if (!args || Object.keys(args).length === 0) {
    return { text: sql, values: [] };
  }

  const values: unknown[] = [];
  const indexMap = new Map<string, number>();
  let text = "";

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarQuoteTag: string | null = null;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const ahead = sql.slice(i);

    if (inLineComment) {
      text += char;
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (ahead.startsWith("*/")) {
        text += "*/";
        i += 1;
        inBlockComment = false;
      } else {
        text += char;
      }
      continue;
    }

    if (dollarQuoteTag) {
      if (ahead.startsWith(dollarQuoteTag)) {
        text += dollarQuoteTag;
        i += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      } else {
        text += char;
      }
      continue;
    }

    if (inSingleQuote) {
      text += char;
      if (char === "'" && sql[i + 1] === "'") {
        text += "'";
        i += 1;
      } else if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      text += char;
      if (char === '"' && sql[i + 1] === '"') {
        text += '"';
        i += 1;
      } else if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    const dollarMatch = ahead.match(/^\$[A-Za-z0-9_]*\$/);
    if (dollarMatch) {
      const [tag] = dollarMatch;
      text += tag;
      dollarQuoteTag = tag;
      i += tag.length - 1;
      continue;
    }

    if (ahead.startsWith("--")) {
      text += "--";
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ahead.startsWith("/*")) {
      text += "/*";
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (char === "'") {
      text += char;
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      text += char;
      inDoubleQuote = true;
      continue;
    }

    if (
      char === ":" &&
      sql[i - 1] !== ":" &&
      /[A-Za-z_]/.test(sql[i + 1] ?? "")
    ) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j] ?? "")) {
        j += 1;
      }
      const name = sql.slice(i + 1, j);
      if (!(name in args)) {
        throw new DatabaseError(`Missing value for SQL parameter :${name}`);
      }
      let index = indexMap.get(name);
      if (index === undefined) {
        values.push(args[name]);
        index = values.length;
        indexMap.set(name, index);
      }
      text += `$${index}`;
      i = j - 1;
    } else {
      text += char;
    }
  }

  return { text, values };
}

async function executePostgres(
  connectionString: string,
  sql: string,
  args: Record<string, unknown> | undefined,
  expectResult: boolean,
  limit: number
): Promise<ExecuteResultRead | ExecuteResultWrite> {
  const pool = getPostgresPool(connectionString);
  const client: PoolClient = await pool.connect();
  try {
    const { text, values } = bindPostgresParameters(sql, args);
    const result = await client.query({ text, values });
    if (expectResult) {
      const truncated = result.rows.length > limit;
      return {
        rows: result.rows.slice(0, limit),
        truncated,
      };
    }
    return { rowcount: result.rowCount ?? 0 };
  } catch (error) {
    throw new DatabaseError((error as Error).message);
  } finally {
    client.release();
  }
}

async function executeSqlite(
  path: string,
  sql: string,
  args: Record<string, unknown> | undefined,
  expectResult: boolean,
  limit: number
): Promise<ExecuteResultRead | ExecuteResultWrite> {
  const db = await getSqliteDatabase(path);
  try {
    if (expectResult) {
      const rows = (await db.all(sql, args ?? {})) as Array<Record<string, unknown>>;
      const truncated = rows.length > limit;
      return {
        rows: rows.slice(0, limit),
        truncated,
      };
    }
    const result = await db.run(sql, args ?? {});
    const changes = typeof result.changes === "number" ? result.changes : 0;
    return { rowcount: changes };
  } catch (error) {
    throw new DatabaseError((error as Error).message);
  }
}
