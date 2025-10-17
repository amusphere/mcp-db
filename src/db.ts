import { Pool, PoolClient } from "pg";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import mysql from "mysql2/promise";

export type Driver = "postgres" | "sqlite" | "mysql";

export interface NormalizedDatabaseConfig {
  driver: Driver;
  key: string;
  connectionString: string;
  sqlitePath?: string;
}

sqlite3.verbose();

const postgresPools = new Map<string, Pool>();
const sqliteDbs = new Map<string, Promise<Database<sqlite3.Database, sqlite3.Statement>>>();
const mysqlPools = new Map<string, mysql.Pool>();

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

  if (normalized.startsWith("mysql://") || normalized.startsWith("mariadb://")) {
    // Convert mariadb:// to mysql:// for compatibility
    const mysqlUrl = normalized.replace(/^mariadb:\/\//, "mysql://");
    return {
      driver: "mysql",
      key: mysqlUrl,
      connectionString: mysqlUrl,
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

function getMysqlPool(connectionString: string): mysql.Pool {
  const existing = mysqlPools.get(connectionString);
  if (existing) {
    return existing;
  }
  const pool = mysql.createPool(connectionString);
  mysqlPools.set(connectionString, pool);
  return pool;
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

  if (config.driver === "mysql") {
    const pool = getMysqlPool(config.connectionString);
    const connection = await pool.getConnection();
    try {
      let query =
        "SELECT table_schema, table_name FROM information_schema.tables " +
        "WHERE table_type IN ('BASE TABLE', 'VIEW') " +
        "AND table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')";
      const params: unknown[] = [];

      if (schema) {
        query += " AND table_schema = ?";
        params.push(schema);
      }

      query += " ORDER BY table_schema, table_name";
      const [rows] = await connection.query<mysql.RowDataPacket[]>(query, params);
      return rows.map((row) => `${row.TABLE_SCHEMA as string}.${row.TABLE_NAME as string}`);
    } catch (error) {
      throw new DatabaseError((error as Error).message);
    } finally {
      connection.release();
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

  if (config.driver === "mysql") {
    const { schema: resolvedSchema, table: resolvedTable } = splitTableIdentifier(table, schema);
    const pool = getMysqlPool(config.connectionString);
    const connection = await pool.getConnection();
    try {
      // If no schema specified, use the database from the connection string
      let schemaName = resolvedSchema;
      if (!schemaName) {
        const [dbRows] = await connection.query<mysql.RowDataPacket[]>("SELECT DATABASE() as db");
        schemaName = dbRows[0]?.db as string;
      }

      const query =
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns " +
        "WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position";
      const [rows] = await connection.query<mysql.RowDataPacket[]>(query, [schemaName, resolvedTable]);
      return rows.map((row) => ({
        column_name: row.COLUMN_NAME as string,
        data_type: row.DATA_TYPE as string,
        is_nullable: row.IS_NULLABLE === "YES",
      }));
    } catch (error) {
      throw new DatabaseError((error as Error).message);
    } finally {
      connection.release();
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
  if (config.driver === "mysql") {
    return executeMysql(config.connectionString, sql, args, expectResult, limit);
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
    // SQLite library requires parameter keys to have ':' prefix
    const sqliteArgs: Record<string, unknown> = {};
    if (args) {
      for (const [key, value] of Object.entries(args)) {
        sqliteArgs[`:${key}`] = value;
      }
    }

    if (expectResult) {
      const rows = (await db.all(sql, sqliteArgs)) as Array<Record<string, unknown>>;
      const truncated = rows.length > limit;
      return {
        rows: rows.slice(0, limit),
        truncated,
      };
    }
    const result = await db.run(sql, sqliteArgs);
    const changes = typeof result.changes === "number" ? result.changes : 0;
    return { rowcount: changes };
  } catch (error) {
    throw new DatabaseError((error as Error).message);
  }
}

function isEscapedWithBackslash(text: string, index: number): boolean {
  let backslashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function bindMysqlParameters(
  sql: string,
  args: Record<string, unknown> | undefined
): { sql: string; values: unknown[] } {
  if (!args || Object.keys(args).length === 0) {
    return { sql, values: [] };
  }

  const values: unknown[] = [];
  let text = "";

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  const isIdentifierStart = (ch: string | undefined): boolean => !!ch && /[A-Za-z_]/.test(ch);
  const isIdentifierChar = (ch: string | undefined): boolean => !!ch && /[A-Za-z0-9_]/.test(ch);

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

    if (inSingleQuote) {
      text += char;
      if (char === "'" && sql[i + 1] === "'") {
        text += "'";
        i += 1;
      } else if (char === "'" && !isEscapedWithBackslash(sql, i)) {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      text += char;
      if (char === '"' && sql[i + 1] === '"') {
        text += '"';
        i += 1;
      } else if (char === '"' && !isEscapedWithBackslash(sql, i)) {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inBacktick) {
      text += char;
      if (char === "`" && sql[i + 1] === "`") {
        text += "`";
        i += 1;
      } else if (char === "`") {
        inBacktick = false;
      }
      continue;
    }

    if (ahead.startsWith("--")) {
      text += "--";
      i += 1;
      inLineComment = true;
      continue;
    }

    if (char === "#") {
      text += char;
      inLineComment = true;
      continue;
    }

    if (ahead.startsWith("/*")) {
      text += "/*";
      i += 1;
      inBlockComment = true;
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

    if (char === "`") {
      text += char;
      inBacktick = true;
      continue;
    }

    if (char === ":" && sql[i - 1] !== ":" && isIdentifierStart(sql[i + 1])) {
      let j = i + 1;
      while (isIdentifierChar(sql[j])) {
        j += 1;
      }
      const name = sql.slice(i + 1, j);
      if (!(name in args)) {
        throw new DatabaseError(`Missing value for SQL parameter :${name}`);
      }
      text += "?";
      values.push(args[name]);
      i = j - 1;
      continue;
    }

    text += char;
  }

  return { sql: text, values };
}

async function executeMysql(
  connectionString: string,
  sql: string,
  args: Record<string, unknown> | undefined,
  expectResult: boolean,
  limit: number
): Promise<ExecuteResultRead | ExecuteResultWrite> {
  const pool = getMysqlPool(connectionString);
  const connection = await pool.getConnection();
  try {
    // Convert :param to ? placeholders for MySQL
    const { sql: processedSql, values: paramValues } = bindMysqlParameters(sql, args);
    const [result] = await connection.query(processedSql, paramValues);

    if (expectResult) {
      const rows = result as mysql.RowDataPacket[];
      const truncated = rows.length > limit;
      return {
        rows: rows.slice(0, limit) as Record<string, unknown>[],
        truncated,
      };
    }

    const writeResult = result as mysql.ResultSetHeader;
    return { rowcount: writeResult.affectedRows ?? 0 };
  } catch (error) {
    throw new DatabaseError((error as Error).message);
  } finally {
    connection.release();
  }
}

export interface ExplainResult {
  plan: Record<string, unknown>[];
  query: string;
}

export async function explainQuery(
  config: NormalizedDatabaseConfig,
  sql: string,
  args: Record<string, unknown> | undefined,
  analyze: boolean
): Promise<ExplainResult> {
  if (config.driver === "postgres") {
    return explainPostgres(config.connectionString, sql, args, analyze);
  }
  if (config.driver === "sqlite") {
    return explainSqlite(config.sqlitePath!, sql, args, analyze);
  }
  if (config.driver === "mysql") {
    return explainMysql(config.connectionString, sql, args, analyze);
  }
  throw new DatabaseError("Unsupported database driver");
}

async function explainPostgres(
  connectionString: string,
  sql: string,
  args: Record<string, unknown> | undefined,
  analyze: boolean
): Promise<ExplainResult> {
  const pool = getPostgresPool(connectionString);
  const client: PoolClient = await pool.connect();
  try {
    const { text, values } = bindPostgresParameters(sql, args);
    const explainSql = analyze
      ? `EXPLAIN (ANALYZE, FORMAT JSON) ${text}`
      : `EXPLAIN (FORMAT JSON) ${text}`;
    const result = await client.query({ text: explainSql, values });
    return {
      plan: result.rows[0]?.["QUERY PLAN"] ?? [],
      query: text,
    };
  } catch (error) {
    throw new DatabaseError((error as Error).message);
  } finally {
    client.release();
  }
}

async function explainSqlite(
  path: string,
  sql: string,
  args: Record<string, unknown> | undefined,
  analyze: boolean
): Promise<ExplainResult> {
  const db = await getSqliteDatabase(path);
  try {
    // Default to EXPLAIN QUERY PLAN for human-readable plans; only use raw bytecode when analyze=true.
    const explainCommand = analyze ? "EXPLAIN" : "EXPLAIN QUERY PLAN";

    // For SQLite, we need to replace named parameters with placeholders
    // before running EXPLAIN, since EXPLAIN doesn't bind parameters
    let processedSql = sql;
    let paramValues: unknown[] = [];

    if (args && Object.keys(args).length > 0) {
      const replacement = replaceSqliteNamedParameters(sql, args);
      processedSql = replacement.sql;
      paramValues = replacement.values;
    }

    const explainSql = `${explainCommand} ${processedSql}`;
    const rows = (await db.all(explainSql, paramValues)) as Array<Record<string, unknown>>;
    return {
      plan: rows,
      query: sql,
    };
  } catch (error) {
    throw new DatabaseError((error as Error).message);
  }
}

async function explainMysql(
  connectionString: string,
  sql: string,
  args: Record<string, unknown> | undefined,
  analyze: boolean
): Promise<ExplainResult> {
  const pool = getMysqlPool(connectionString);
  const connection = await pool.getConnection();
  try {
    // Convert :param to ? placeholders for MySQL
    const { sql: processedSql, values: paramValues } = bindMysqlParameters(sql, args);

    // MySQL supports EXPLAIN and EXPLAIN ANALYZE (8.0.18+)
    const explainFormat = analyze ? "EXPLAIN ANALYZE" : "EXPLAIN FORMAT=JSON";
    const explainSql = `${explainFormat} ${processedSql}`;

    const [rows] = await connection.query(explainSql, paramValues);

    // For EXPLAIN FORMAT=JSON, MySQL returns a single row with a JSON string
    // For EXPLAIN ANALYZE, it returns the execution plan as text
    if (analyze) {
      // EXPLAIN ANALYZE returns RowDataPacket[]
      const result = rows as mysql.RowDataPacket[];
      return {
        plan: result as Record<string, unknown>[],
        query: sql,
      };
    } else {
      // EXPLAIN FORMAT=JSON returns a single row with EXPLAIN column containing JSON
      const result = rows as mysql.RowDataPacket[];
      const jsonPlan = result[0]?.EXPLAIN;
      if (typeof jsonPlan === "string") {
        return {
          plan: [JSON.parse(jsonPlan) as Record<string, unknown>],
          query: sql,
        };
      }
      return {
        plan: result as Record<string, unknown>[],
        query: sql,
      };
    }
  } catch (error) {
    throw new DatabaseError((error as Error).message);
  } finally {
    connection.release();
  }
}

function replaceSqliteNamedParameters(
  sql: string,
  args: Record<string, unknown>
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  let result = "";
  const length = sql.length;
  let index = 0;

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBracket = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (index < length) {
    const char = sql[index]!;
    const nextChar = index + 1 < length ? sql[index + 1]! : undefined;

    if (inLineComment) {
      result += char;
      if (char === "\n") {
        inLineComment = false;
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      result += char;
      if (char === "*" && nextChar === "/") {
        result += nextChar;
        index += 2;
        inBlockComment = false;
      } else {
        index += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      result += char;
      if (char === "'") {
        if (nextChar === "'") {
          result += nextChar;
          index += 2;
          continue;
        }
        inSingleQuote = false;
      }
      index += 1;
      continue;
    }

    if (inDoubleQuote) {
      result += char;
      if (char === '"') {
        if (nextChar === '"') {
          result += nextChar;
          index += 2;
          continue;
        }
        inDoubleQuote = false;
      }
      index += 1;
      continue;
    }

    if (inBacktick) {
      result += char;
      if (char === "`") {
        if (nextChar === "`") {
          result += nextChar;
          index += 2;
          continue;
        }
        inBacktick = false;
      }
      index += 1;
      continue;
    }

    if (inBracket) {
      result += char;
      if (char === "]") {
        if (nextChar === "]") {
          result += nextChar;
          index += 2;
          continue;
        }
        inBracket = false;
      }
      index += 1;
      continue;
    }

    if (char === "-" && nextChar === "-") {
      result += char + nextChar;
      index += 2;
      inLineComment = true;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      result += char + nextChar;
      index += 2;
      inBlockComment = true;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      result += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      result += char;
      index += 1;
      continue;
    }

    if (char === "`") {
      inBacktick = true;
      result += char;
      index += 1;
      continue;
    }

    if (char === "[") {
      inBracket = true;
      result += char;
      index += 1;
      continue;
    }

    if (char === ":" && nextChar && /[A-Za-z_]/.test(nextChar)) {
      let nameEnd = index + 2;
      while (nameEnd < length && /[A-Za-z0-9_]/.test(sql[nameEnd]!)) {
        nameEnd += 1;
      }
      const paramName = sql.slice(index + 1, nameEnd);
      if (!Object.prototype.hasOwnProperty.call(args, paramName)) {
        throw new DatabaseError(`Missing value for SQL parameter :${paramName}`);
      }
      result += "?";
      values.push(args[paramName]);
      index = nameEnd;
      continue;
    }

    result += char;
    index += 1;
  }

  return { sql: result, values };
}
