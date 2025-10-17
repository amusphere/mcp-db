import type { FastifyInstance } from "fastify";
import { getSettings } from "./config.js";
import {
  DatabaseError,
  describeTable,
  executeSql,
  explainQuery,
  listTables,
  normalizeDatabaseUrl,
  type NormalizedDatabaseConfig,
} from "./db.js";
import {
  SQLValidationError,
  StatementCategory,
  classifyStatement,
  enforceSingleStatement,
  validateAllowlist,
} from "./sqlGuard.js";
import { logger, generateTraceId, generateSpanId, type LogContext } from "./logger.js";
import { recordQueryDuration, recordError } from "./metrics.js";

const settings = getSettings();
const normalizedAllowlist = new Set(settings.allowlistTables.map((item) => item.toLowerCase()));

interface TablesRequestBody {
  db_url?: string;
  schema?: string;
}

interface DescribeRequestBody {
  db_url?: string;
  schema?: string;
  table: string;
}

interface ExecuteRequestBody {
  db_url?: string;
  sql: string;
  args?: Record<string, unknown>;
  allow_write?: boolean;
  row_limit?: number;
}

interface ExplainRequestBody {
  db_url?: string;
  sql: string;
  args?: Record<string, unknown>;
  analyze?: boolean;
}

function auditLog(trace_id: string, span_id: string, tool: string, context: LogContext): void {
  if (context.error) {
    logger.error("HTTP request failed", { trace_id, span_id, tool, ...context });
  } else {
    logger.info("HTTP request completed", { trace_id, span_id, tool, ...context });
  }
}

function allowlistAliases(table: string): Set<string> {
  const lowered = table.toLowerCase();
  const aliases = new Set<string>([lowered]);
  if (lowered.includes(".")) {
    const [schema, name] = lowered.split(".", 2);
    aliases.add(name);
    aliases.add(`${schema}.${name}`);
  } else {
    aliases.add(`public.${lowered}`);
  }
  return aliases;
}

function ensureTableAllowed(table: string, schema?: string): void {
  if (normalizedAllowlist.size === 0) {
    return;
  }
  const candidate = table.includes(".") ? table : schema ? `${schema}.${table}` : table;
  const aliases = allowlistAliases(candidate);
  for (const alias of aliases) {
    if (normalizedAllowlist.has(alias)) {
      return;
    }
  }
  throw new SQLValidationError("Table not allowlisted");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), timeoutMs).unref();
    }),
  ]);
}

function resolveDatabaseConfig(bodyUrl?: string): NormalizedDatabaseConfig {
  const dbUrl = bodyUrl ?? settings.dbUrl;
  return normalizeDatabaseUrl(dbUrl);
}

export function registerRoutes(app: FastifyInstance): void {
  app.post<{ Body: TablesRequestBody }>(
    "/tools/db.tables",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            db_url: { type: "string" },
            schema: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const trace_id = generateTraceId();
      const span_id = generateSpanId();
      const start = Date.now();
      
      if (settings.requireApiKey) {
        const header = request.headers["x-api-key"];
        if (header !== settings.apiKey) {
          auditLog(trace_id, span_id, "db.tables", {
            category: "metadata",
            duration_ms: Date.now() - start,
            error: "unauthorized",
          });
          await reply.status(401).send({ detail: "Invalid API key" });
          return;
        }
      }
      let config: NormalizedDatabaseConfig;
      try {
        config = resolveDatabaseConfig(request.body?.db_url);
      } catch (error) {
        const message = (error as Error).message;
        auditLog(trace_id, span_id, "db.tables", {
          category: "metadata",
          duration_ms: Date.now() - start,
          error: message,
        });
        await reply.status(400).send({ detail: message });
        return;
      }

      try {
        const tables = await withTimeout(
          listTables(config, request.body?.schema),
          settings.queryTimeoutMs
        );
        const filtered =
          normalizedAllowlist.size === 0
            ? tables
            : tables.filter((table) => {
                const aliases = allowlistAliases(table);
                for (const alias of aliases) {
                  if (normalizedAllowlist.has(alias)) {
                    return true;
                  }
                }
                return false;
              });
        const duration_ms = Date.now() - start;
        recordQueryDuration("db.tables", config.driver, "metadata", duration_ms / 1000);
        auditLog(trace_id, span_id, "db.tables", {
          category: "metadata",
          db: config.driver,
          duration_ms,
          tables: filtered.length,
        });
        await reply.send({ tables: filtered });
      } catch (error) {
        if ((error as Error).message === "timeout") {
          recordError("db.tables", "unknown", "timeout");
          auditLog(trace_id, span_id, "db.tables", {
            category: "metadata",
            duration_ms: Date.now() - start,
            error: "timeout",
          });
          await reply.status(504).send({ detail: "Query timed out" });
          return;
        }
        recordError("db.tables", "unknown", "error");
        const message = (error as Error).message;
        auditLog(trace_id, span_id, "db.tables", {
          category: "metadata",
          duration_ms: Date.now() - start,
          error: message,
        });
        await reply.status(400).send({ detail: message });
      }
    }
  );

  app.post<{ Body: DescribeRequestBody }>(
    "/tools/db.describe_table",
    {
      schema: {
        body: {
          type: "object",
          required: ["table"],
          properties: {
            db_url: { type: "string" },
            schema: { type: "string" },
            table: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const trace_id = generateTraceId();
      const span_id = generateSpanId();
      const start = Date.now();
      
      if (settings.requireApiKey) {
        const header = request.headers["x-api-key"];
        if (header !== settings.apiKey) {
          auditLog(trace_id, span_id, "db.describe_table", {
            category: "metadata",
            duration_ms: Date.now() - start,
            error: "unauthorized",
          });
          await reply.status(401).send({ detail: "Invalid API key" });
          return;
        }
      }
      let config: NormalizedDatabaseConfig;
      try {
        config = resolveDatabaseConfig(request.body?.db_url);
      } catch (error) {
        const message = (error as Error).message;
        auditLog(trace_id, span_id, "db.describe_table", {
          category: "metadata",
          duration_ms: Date.now() - start,
          error: message,
        });
        await reply.status(400).send({ detail: message });
        return;
      }

      try {
        ensureTableAllowed(request.body.table, request.body?.schema);
      } catch (error) {
        const message = (error as Error).message;
        auditLog(trace_id, span_id, "db.describe_table", {
          category: "metadata",
          duration_ms: Date.now() - start,
          error: message,
        });
        await reply.status(403).send({ detail: message });
        return;
      }

      try {
        const columns = await withTimeout(
          describeTable(config, request.body.table, request.body?.schema),
          settings.queryTimeoutMs
        );
        if (columns.length === 0) {
          auditLog(trace_id, span_id, "db.describe_table", {
            category: "metadata",
            db: config.driver,
            duration_ms: Date.now() - start,
            columns: 0,
            error: "not_found",
          });
          await reply.status(404).send({ detail: "Table not found" });
          return;
        }
        const duration_ms = Date.now() - start;
        recordQueryDuration("db.describe_table", config.driver, "metadata", duration_ms / 1000);
        auditLog(trace_id, span_id, "db.describe_table", {
          category: "metadata",
          db: config.driver,
          duration_ms,
          columns: columns.length,
        });
        await reply.send({ columns });
      } catch (error) {
        if ((error as Error).message === "timeout") {
          recordError("db.describe_table", "unknown", "timeout");
          auditLog(trace_id, span_id, "db.describe_table", {
            category: "metadata",
            duration_ms: Date.now() - start,
            error: "timeout",
          });
          await reply.status(504).send({ detail: "Query timed out" });
          return;
        }
        recordError("db.describe_table", "unknown", "error");
        const message = error instanceof DatabaseError ? error.message : (error as Error).message;
        auditLog(trace_id, span_id, "db.describe_table", {
          category: "metadata",
          duration_ms: Date.now() - start,
          error: message,
        });
        await reply.status(400).send({ detail: message });
      }
    }
  );

  app.post<{ Body: ExecuteRequestBody }>(
    "/tools/db.execute",
    {
      schema: {
        body: {
          type: "object",
          required: ["sql"],
          properties: {
            db_url: { type: "string" },
            sql: { type: "string" },
            args: { type: "object", additionalProperties: true },
            allow_write: { type: "boolean" },
            row_limit: { type: "integer", minimum: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const trace_id = generateTraceId();
      const span_id = generateSpanId();
      const start = Date.now();
      const body = request.body;
      
      if (settings.requireApiKey) {
        const header = request.headers["x-api-key"];
        if (header !== settings.apiKey) {
          auditLog(trace_id, span_id, "db.execute", {
            category: "unknown",
            duration_ms: Date.now() - start,
            error: "unauthorized",
          });
          await reply.status(401).send({ detail: "Invalid API key" });
          return;
        }
      }
      let config: NormalizedDatabaseConfig;
      let normalizedSql: string;
      try {
        config = resolveDatabaseConfig(body.db_url);
        normalizedSql = enforceSingleStatement(body.sql);
        validateAllowlist(normalizedSql, settings.allowlistTables);
      } catch (error) {
        const message = (error as Error).message;
        const status = error instanceof SQLValidationError ? 403 : 400;
        auditLog(trace_id, span_id, "db.execute", {
          category: "unknown",
          duration_ms: Date.now() - start,
          error: message,
        });
        await reply.status(status).send({ detail: message });
        return;
      }

      const category = classifyStatement(normalizedSql);
      if (category === StatementCategory.UNKNOWN) {
        auditLog(trace_id, span_id, "db.execute", {
          category: "unknown",
          duration_ms: Date.now() - start,
          error: "unsupported",
        });
        await reply.status(400).send({ detail: "Unsupported SQL statement" });
        return;
      }
      if (category === StatementCategory.DDL && !settings.allowDdl) {
        auditLog(trace_id, span_id, "db.execute", {
          category: category.valueOf(),
          duration_ms: Date.now() - start,
          error: "ddl_disabled",
        });
        await reply.status(403).send({ detail: "DDL statements are disabled" });
        return;
      }
      if (
        category === StatementCategory.WRITE &&
        (!settings.allowWrites || !body.allow_write)
      ) {
        auditLog(trace_id, span_id, "db.execute", {
          category: category.valueOf(),
          duration_ms: Date.now() - start,
          error: "write_disabled",
        });
        await reply
          .status(403)
          .send({ detail: "Write operations require explicit server and request approval" });
        return;
      }

      let effectiveLimit = settings.maxRows;
      if (body.row_limit !== undefined) {
        if (!Number.isInteger(body.row_limit) || body.row_limit <= 0) {
          auditLog(trace_id, span_id, "db.execute", {
            category: category.valueOf(),
            duration_ms: Date.now() - start,
            error: "invalid_row_limit",
          });
          await reply.status(400).send({ detail: "row_limit must be a positive integer" });
          return;
        }
        effectiveLimit = Math.min(body.row_limit, settings.maxRows);
      }

      const expectResult = category === StatementCategory.READ;
      try {
        const result = await withTimeout(
          executeSql(config, normalizedSql, body.args, expectResult, effectiveLimit),
          settings.queryTimeoutMs
        );
        const duration_ms = Date.now() - start;
        recordQueryDuration("db.execute", config.driver, category.valueOf(), duration_ms / 1000);
        if (expectResult) {
          const readResult = result as { rows: Record<string, unknown>[]; truncated: boolean };
          auditLog(trace_id, span_id, "db.execute", {
            category: category.valueOf(),
            db: config.driver,
            duration_ms,
            rows: readResult.rows.length,
            truncated: readResult.truncated,
          });
          await reply.send(readResult);
        } else {
          const writeResult = result as { rowcount: number };
          auditLog(trace_id, span_id, "db.execute", {
            category: category.valueOf(),
            db: config.driver,
            duration_ms,
            rowcount: writeResult.rowcount,
          });
          await reply.send(writeResult);
        }
      } catch (error) {
        if ((error as Error).message === "timeout") {
          recordError("db.execute", config.driver, "timeout");
          auditLog(trace_id, span_id, "db.execute", {
            category: category.valueOf(),
            duration_ms: Date.now() - start,
            error: "timeout",
          });
          await reply.status(504).send({ detail: "Query timed out" });
          return;
        }
        recordError("db.execute", config.driver, "error");
        const message = error instanceof DatabaseError ? error.message : (error as Error).message;
        auditLog(trace_id, span_id, "db.execute", {
          category: category.valueOf(),
          duration_ms: Date.now() - start,
          error: message,
        });
        await reply.status(400).send({ detail: message });
      }
    }
  );

  app.post<{ Body: ExplainRequestBody }>(
    "/tools/db.explain",
    {
      schema: {
        body: {
          type: "object",
          required: ["sql"],
          properties: {
            db_url: { type: "string" },
            sql: { type: "string" },
            args: { type: "object", additionalProperties: true },
            analyze: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const trace_id = generateTraceId();
      const span_id = generateSpanId();
      const start = Date.now();
      const body = request.body;
      
      if (settings.requireApiKey) {
        const header = request.headers["x-api-key"];
        if (header !== settings.apiKey) {
          auditLog(trace_id, span_id, "db.explain", {
            category: "metadata",
            duration_ms: Date.now() - start,
            error: "unauthorized",
          });
          await reply.status(401).send({ detail: "Invalid API key" });
          return;
        }
      }
      let config: NormalizedDatabaseConfig;
      let normalizedSql: string;
      try {
        config = resolveDatabaseConfig(body.db_url);
        normalizedSql = enforceSingleStatement(body.sql);
        validateAllowlist(normalizedSql, settings.allowlistTables);
      } catch (error) {
        const message = (error as Error).message;
        const status = error instanceof SQLValidationError ? 403 : 400;
        auditLog(trace_id, span_id, "db.explain", {
          category: "metadata",
          duration_ms: Date.now() - start,
          error: message,
        });
        await reply.status(status).send({ detail: message });
        return;
      }

      try {
        const result = await withTimeout(
          explainQuery(config, normalizedSql, body.args, body.analyze ?? false),
          settings.queryTimeoutMs
        );
        const duration_ms = Date.now() - start;
        recordQueryDuration("db.explain", config.driver, "explain", duration_ms / 1000);
        auditLog(trace_id, span_id, "db.explain", {
          category: "metadata",
          db: config.driver,
          duration_ms,
          analyze: body.analyze ?? false,
        });
        await reply.send(result);
      } catch (error) {
        if ((error as Error).message === "timeout") {
          recordError("db.explain", "unknown", "timeout");
          auditLog(trace_id, span_id, "db.explain", {
            category: "metadata",
            duration_ms: Date.now() - start,
            error: "timeout",
          });
          await reply.status(504).send({ detail: "Query timed out" });
          return;
        }
        recordError("db.explain", "unknown", "error");
        const message = error instanceof DatabaseError ? error.message : (error as Error).message;
        auditLog(trace_id, span_id, "db.explain", {
          category: "metadata",
          duration_ms: Date.now() - start,
          error: message,
        });
        await reply.status(400).send({ detail: message });
      }
    }
  );
}
