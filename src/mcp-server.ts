#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
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

const settings = getSettings();
const normalizedAllowlist = new Set(settings.allowlistTables.map((item) => item.toLowerCase()));

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

const server = new Server(
  {
    name: "@amusphere/mcp-db",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define MCP tools
const tools: Tool[] = [
  {
    name: "db_tables",
    description: "List all tables in the database, optionally filtered by schema. Returns qualified table names.",
    inputSchema: {
      type: "object",
      properties: {
        db_url: {
          type: "string",
          description: "Optional database URL override (e.g., sqlite:///./dev.db, postgresql://...)",
        },
        schema: {
          type: "string",
          description: "Optional schema name filter (PostgreSQL only)",
        },
      },
    },
  },
  {
    name: "db_describe_table",
    description: "Get column information for a specific table including column names, data types, and nullability.",
    inputSchema: {
      type: "object",
      properties: {
        db_url: {
          type: "string",
          description: "Optional database URL override",
        },
        schema: {
          type: "string",
          description: "Optional schema name (PostgreSQL only)",
        },
        table: {
          type: "string",
          description: "Table name to describe",
        },
      },
      required: ["table"],
    },
  },
  {
    name: "db_execute",
    description: "Execute a SQL statement. Supports SELECT (read), INSERT/UPDATE/DELETE (write if enabled), and DDL (if enabled). Use named parameters with :param syntax.",
    inputSchema: {
      type: "object",
      properties: {
        db_url: {
          type: "string",
          description: "Optional database URL override",
        },
        sql: {
          type: "string",
          description: "SQL statement to execute (single statement only)",
        },
        args: {
          type: "object",
          description: "Named parameters for the SQL statement (e.g., {name: 'John'})",
        },
        allow_write: {
          type: "boolean",
          description: "Set to true to allow write operations (requires ALLOW_WRITES=true)",
        },
        row_limit: {
          type: "number",
          description: "Maximum rows to return for SELECT queries",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "db_explain",
    description: "Get query execution plan and performance information using EXPLAIN. Helps analyze query performance and optimization opportunities.",
    inputSchema: {
      type: "object",
      properties: {
        db_url: {
          type: "string",
          description: "Optional database URL override",
        },
        sql: {
          type: "string",
          description: "SQL query to explain (typically a SELECT statement)",
        },
        args: {
          type: "object",
          description: "Named parameters for the SQL statement (e.g., {name: 'John'})",
        },
        analyze: {
          type: "boolean",
          description: "Run EXPLAIN ANALYZE to get actual execution statistics (executes the query)",
        },
      },
      required: ["sql"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "db_tables": {
        const config = resolveDatabaseConfig(args?.db_url as string | undefined);
        const tables = await withTimeout(
          listTables(config, args?.schema as string | undefined),
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
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ tables: filtered }, null, 2),
            },
          ],
        };
      }

      case "db_describe_table": {
        const table = args?.table as string;
        if (!table) {
          throw new Error("table parameter is required");
        }
        const config = resolveDatabaseConfig(args?.db_url as string | undefined);
        ensureTableAllowed(table, args?.schema as string | undefined);
        const columns = await withTimeout(
          describeTable(config, table, args?.schema as string | undefined),
          settings.queryTimeoutMs
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ columns }, null, 2),
            },
          ],
        };
      }

      case "db_execute": {
        const sql = args?.sql as string;
        if (!sql) {
          throw new Error("sql parameter is required");
        }

        const config = resolveDatabaseConfig(args?.db_url as string | undefined);
        const validated = enforceSingleStatement(sql);
        const category = classifyStatement(validated);

        if (category === StatementCategory.UNKNOWN) {
          throw new SQLValidationError("SQL statement type not recognized");
        }

        const requestAllowWrite = args?.allow_write === true;
        if (category === StatementCategory.WRITE) {
          if (!settings.allowWrites) {
            throw new SQLValidationError(
              "Write operations disabled (set ALLOW_WRITES=true to enable)"
            );
          }
          if (!requestAllowWrite) {
            throw new SQLValidationError(
              "Write operation requires allow_write: true in request"
            );
          }
        }

        if (category === StatementCategory.DDL) {
          if (!settings.allowDdl) {
            throw new SQLValidationError(
              "DDL operations disabled (set ALLOW_DDL=true to enable)"
            );
          }
        }

        validateAllowlist(validated, settings.allowlistTables);

        const expectResult = category === StatementCategory.READ;
        let rowLimit = settings.maxRows;
        if (args?.row_limit !== undefined) {
          const rawLimit = args.row_limit;
          if (
            typeof rawLimit !== "number" ||
            !Number.isInteger(rawLimit) ||
            rawLimit <= 0
          ) {
            throw new SQLValidationError("row_limit must be a positive integer");
          }
          rowLimit = Math.min(rawLimit, settings.maxRows);
        }

        const result = await withTimeout(
          executeSql(
            config,
            validated,
            args?.args as Record<string, unknown> | undefined,
            expectResult,
            rowLimit
          ),
          settings.queryTimeoutMs
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "db_explain": {
        const sql = args?.sql as string;
        if (!sql) {
          throw new Error("sql parameter is required");
        }

        const config = resolveDatabaseConfig(args?.db_url as string | undefined);
        const validated = enforceSingleStatement(sql);

        // Validate allowlist (similar to db_execute)
        validateAllowlist(validated, settings.allowlistTables);

        const analyze = args?.analyze === true;
        const result = await withTimeout(
          explainQuery(
            config,
            validated,
            args?.args as Record<string, unknown> | undefined,
            analyze
          ),
          settings.queryTimeoutMs
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "timeout") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ detail: "Query timed out" }, null, 2),
          },
        ],
        isError: true,
      };
    }
    if (error instanceof SQLValidationError || error instanceof DatabaseError) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: error.message }, null, 2),
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP protocol on stdout
  console.error("MCP Database Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
