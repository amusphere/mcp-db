# MCP Database Server

[![npm version](https://img.shields.io/npm/v/@amusphere/mcp-db.svg)](https://www.npmjs.com/package/@amusphere/mcp-db)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server that provides secure database access for AI assistants and LLM-based tools. Query SQLite, PostgreSQL, MySQL, and MariaDB databases with built-in safety controls, query validation, and audit logging.

## Features

- 🔒 **Secure by Default**: Read-only mode with granular permission controls
- 🗄️ **Multi-Database**: Support for SQLite, PostgreSQL, MySQL, and MariaDB
- 🛡️ **SQL Validation**: Automatic query validation and injection prevention
- 📊 **Table Allowlisting**: Restrict access to specific tables
- ⏱️ **Query Timeouts**: Prevent long-running queries
- 📝 **Audit Logging**: JSON-formatted operation logs
- 🔌 **MCP Protocol**: Native stdio transport for AI assistants
- 🌐 **HTTP Mode**: Optional REST API for legacy integrations

## Supported MCP Clients

- [Codex CLI](https://github.com/modelcontextprotocol/cli)
- [Claude Desktop](https://claude.ai/download)
- [Cline (VS Code Extension)](https://github.com/cline/cline)
- Any MCP-compatible client

## Quick Start

### Installation

The easiest way to use this MCP server is via `npx` (no installation required):

```bash
npx @amusphere/mcp-db
```

### Configuration for MCP Clients

This server is designed to let AI assistants dynamically specify database connections via the `db_url` parameter. You can start the server **without specifying a default database**, and the AI will provide the connection string when needed.

#### Codex CLI

Add to your Codex configuration file (`~/.codex/mcp.toml` or similar):

```toml
[mcp_servers.mcp-db]
command = "npx"
args = ["-y", "@amusphere/mcp-db"]
```

The AI assistant will then specify the database URL in each tool call:
```
You: "Show me tables in my SQLite database at ./data/app.db"
AI: Uses db_url = "sqlite:///./data/app.db" in the tool call
```

#### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "mcp-db": {
      "command": "npx",
      "args": ["-y", "@amusphere/mcp-db"]
    }
  }
}
```

#### Optional: Set a Default Database

If you want to set a default database (can still be overridden by the AI):

```toml
[mcp_servers.mcp-db]
command = "npx"
args = ["-y", "@amusphere/mcp-db", "--host", "sqlite:///./dev.db"]
```

## Usage Examples

### Recommended: Dynamic Database Selection

Start the server without a default database and let the AI specify the connection:

```bash
# Start server (AI will provide db_url in each request)
npx @amusphere/mcp-db

# With security controls
npx @amusphere/mcp-db --allow-writes --allowlist users,posts,comments

# With custom limits
npx @amusphere/mcp-db --max-rows 100 --timeout 30
```

**User conversation examples:**
- "Show tables in sqlite:///./dev.db"
- "Query the production database at postgresql://localhost/prod"
- "Compare user counts between ./dev.db and ./prod.db"

### Alternative: Default Database

If you work primarily with one database, you can set a default (can still be overridden):

```bash
# SQLite default
npx @amusphere/mcp-db --host sqlite:///./dev.db

# PostgreSQL default
npx @amusphere/mcp-db --host postgresql://user:password@localhost:5432/mydb

# With allowlist for default database
npx @amusphere/mcp-db \
  --host sqlite:///./dev.db \
  --allowlist users,posts,comments
```

**User conversation examples:**
- "Show me the tables" (uses default database)
- "Now check the other database at ./other.db" (overrides default)

### Local Development

Clone and build from source:

```bash
git clone https://github.com/amusphere/mcp-db.git
cd mcp-db
npm install
npm run build
npm start -- --host sqlite:///./dev.db
```

Development mode with hot-reload:

```bash
npm run dev
```

### Testing

Comprehensive tests are available for all supported databases. See [tests/README.md](tests/README.md) for detailed testing documentation.

**Quick test commands:**

```bash
# Run all tests (requires Docker)
npm test

# Run individual database tests
npm run test:sqlite      # No Docker required
npm run test:postgres    # Requires PostgreSQL container
npm run test:mysql       # Requires MySQL container
npm run test:mariadb     # Requires MariaDB container
```

**Docker-based testing:**

```bash
# Run all tests in Docker (recommended - auto cleanup)
npm run test:docker

# Or manually manage containers
docker compose up -d postgres mysql mariadb  # Start databases
npm test                                     # Run tests
docker compose down -v                       # Stop and clean up
```

### HTTP Server Mode (Legacy)

For backwards compatibility with HTTP-based integrations:

```bash
npx @amusphere/mcp-db --host sqlite:///./dev.db --http-mode --port 8080
```

This exposes REST endpoints at `http://localhost:8080/tools/*` for non-MCP clients.

## Configuration Reference

### Command Line Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--host <url>` | Optional default database URL (can be overridden by AI via `db_url` parameter) | None |
| `--allow-writes` | Enable INSERT/UPDATE/DELETE operations | `false` |
| `--allow-ddl` | Enable CREATE/ALTER/DROP operations | `false` |
| `--allowlist <tables>` | Comma-separated list of allowed tables (applies to all databases) | All tables |
| `--max-rows <number>` | Maximum rows to return for SELECT queries | `500` |
| `--timeout <seconds>` | Query timeout in seconds | `20` |
| `--http-mode` | Run as HTTP server instead of MCP stdio | `false` |
| `--port <number>` | Port for HTTP mode | `8080` |
| `--require-api-key` | Require X-API-Key header (HTTP mode only) | `false` |
| `--api-key <value>` | Expected API key value | - |

**Note:** The `--host` parameter is optional. If not specified, the AI must provide `db_url` in every tool call. If specified, it serves as a default that can be overridden per-request.

### Database URL Formats

**SQLite:**
```
sqlite:///./path/to/database.db    # Relative path
sqlite:////absolute/path/to/db.db  # Absolute path
sqlite:///:memory:                 # In-memory database
```

**PostgreSQL:**
```
postgresql://username:password@host:port/database
postgresql://localhost/mydb        # Local with defaults
```

**MySQL:**
```
mysql://username:password@host:port/database
mysql://root:password@localhost:3306/mydb
```

**MariaDB:**
```
mariadb://username:password@host:port/database
mariadb://root:password@localhost:3306/mydb
```

Note: MariaDB URLs are automatically converted to MySQL format internally.

### Environment Variables

All command-line arguments can also be set via environment variables (command-line args take precedence):

| Environment Variable | Equivalent Argument |
|---------------------|---------------------|
| `DB_URL` | `--host` |
| `ALLOW_WRITES` | `--allow-writes` |
| `ALLOW_DDL` | `--allow-ddl` |
| `ALLOWLIST_TABLES` | `--allowlist` |
| `MAX_ROWS` | `--max-rows` |
| `QUERY_TIMEOUT_SEC` | `--timeout` |
| `PORT` | `--port` |
| `REQUIRE_API_KEY` | `--require-api-key` |
| `API_KEY` | `--api-key` |

**Example with environment variables:**

```bash
export DB_URL="postgresql://user:pass@localhost:5432/mydb"
export ALLOW_WRITES="true"
export ALLOWLIST_TABLES="users,posts,comments"
npx @amusphere/mcp-db
```

## Available MCP Tools

This server provides four MCP tools for database operations:

### `db_tables`
List all tables in the database.

**Parameters:**
- `db_url` (required/optional): Database URL. Required if no default `--host` is set, otherwise optional to override
- `schema` (optional): Filter by schema (PostgreSQL only)

**Example - Dynamic database selection:**
```json
{
  "db_url": "sqlite:///./data/myapp.db"
}
```

**Example - PostgreSQL with schema:**
```json
{
  "db_url": "postgresql://user:pass@localhost:5432/mydb",
  "schema": "public"
}
```

### `db_describe_table`
Get column information for a specific table.

**Parameters:**
- `table` (required): Table name to describe
- `db_url` (required/optional): Database URL. Required if no default `--host` is set, otherwise optional to override
- `schema` (optional): Schema name (PostgreSQL only)

**Example - Dynamic database selection:**
```json
{
  "db_url": "sqlite:///./users.db",
  "table": "users"
}
```

**Example - With schema (PostgreSQL):**
```json
{
  "db_url": "postgresql://localhost/mydb",
  "table": "users",
  "schema": "public"
}
```

### `db_execute`
Execute a SQL statement with safety controls.

**Parameters:**
- `sql` (required): SQL statement to execute
- `db_url` (required/optional): Database URL. Required if no default `--host` is set, otherwise optional to override
- `args` (optional): Named parameters (use `:param` syntax in SQL)
- `allow_write` (optional): Must be `true` for write operations
- `row_limit` (optional): Override default max rows

**Example - Dynamic query with parameters:**
```json
{
  "db_url": "sqlite:///./data/app.db",
  "sql": "SELECT * FROM users WHERE status = :status LIMIT 10",
  "args": {
    "status": "active"
  }
}
```

**Example - Cross-database query:**
```json
{
  "db_url": "postgresql://user:pass@prod-server:5432/analytics",
  "sql": "SELECT COUNT(*) as total FROM events WHERE date >= :start_date",
  "args": {
    "start_date": "2024-01-01"
  }
}
```

### `db_explain`
Get query execution plan and performance information using EXPLAIN.

**Parameters:**
- `sql` (required): SQL query to analyze (typically a SELECT statement)
- `db_url` (required/optional): Database URL. Required if no default `--host` is set, otherwise optional to override
- `args` (optional): Named parameters (use `:param` syntax in SQL)
- `analyze` (optional): Run EXPLAIN ANALYZE to get actual execution statistics (executes the query)

**Example - Basic query plan (SQLite):**
```json
{
  "db_url": "sqlite:///./data/app.db",
  "sql": "SELECT * FROM users WHERE email = :email",
  "args": {
    "email": "user@example.com"
  }
}
```

**Example - Performance analysis (PostgreSQL):**
```json
{
  "db_url": "postgresql://localhost/mydb",
  "sql": "SELECT u.name, COUNT(o.id) FROM users u JOIN orders o ON u.id = o.user_id GROUP BY u.name",
  "analyze": true
}
```

**Use cases:**
- Identify slow queries and missing indexes
- Analyze JOIN performance and query optimization opportunities
- Compare execution plans between databases
- Verify query efficiency before deploying to production

## How AI Assistants Use These Tools

This server is designed for **dynamic database connections**. AI assistants specify the database URL in each request, allowing you to work with multiple databases seamlessly.

### Example Conversations

**Working with SQLite:**
```
You: "Connect to my SQLite database at ./data/users.db and show me all tables"
AI: Calls db_tables with db_url="sqlite:///./data/users.db"
```

**Switching between databases:**
```
You: "Now check the production database at /var/lib/app/prod.db"
AI: Calls db_tables with db_url="sqlite:////var/lib/app/prod.db"

You: "And also show me tables in the PostgreSQL analytics database"
AI: Calls db_tables with db_url="postgresql://user:pass@localhost:5432/analytics"
```

**Natural language queries:**
```
You: "How many users are in the SQLite database at ./users.db?"
AI: Calls db_execute with:
    - db_url="sqlite:///./users.db"
    - sql="SELECT COUNT(*) FROM users"
```

### Supported Operations

When you connect an AI assistant (like Claude or Codex) to this MCP server, it can:

1. **Connect to any database dynamically**: Specify different databases in natural language
2. **Explore database structure**: "What tables are in database X?"
3. **Understand table schemas**: "Show me the columns in the users table from database Y"
4. **Query data**: "How many active users in the production database?"
5. **Analyze query performance**: "Explain the execution plan for this query"
6. **Compare across databases**: "Compare user counts between dev.db and prod.db"
7. **Optimize queries**: "Find slow queries and suggest indexes"

The AI assistant will automatically extract the database path/URL from your request and use the appropriate tool with the correct `db_url` parameter.

## Configuration Reference

1. **Default is READ-ONLY**: Write and DDL operations require explicit enabling
2. **Use allowlists**: Restrict access to specific tables with `--allowlist`
3. **Set query limits**: Use `--max-rows` and `--timeout` to prevent resource exhaustion
4. **Named parameters**: Always use `:param` syntax to avoid SQL injection
5. **Audit logging**: All operations are logged to stderr in JSON format

## Security Best Practices

1. **Default is READ-ONLY**: Write and DDL operations require explicit enabling
2. **Use allowlists**: Restrict access to specific tables with `--allowlist`
3. **Set query limits**: Use `--max-rows` and `--timeout` to prevent resource exhaustion
4. **Named parameters**: Always use `:param` syntax to avoid SQL injection
5. **Audit logging**: All operations are logged to stderr in JSON format
6. **Separate credentials**: Use read-only database users when possible
7. **Network security**: For remote databases, use SSL/TLS connections

### Audit Logs

All database operations are logged to stderr in JSON format:

```json
{
  "timestamp": "2024-01-17T10:30:45.123Z",
  "tool": "db_execute",
  "category": "read",
  "duration_ms": 42,
  "rowcount": 10,
  "sql": "SELECT * FROM users LIMIT 10"
}
```

## Troubleshooting

### Connection Issues

**SQLite file not found:**
```bash
# Use absolute path
npx @amusphere/mcp-db --host sqlite:////absolute/path/to/db.db

# Or relative from current directory
npx @amusphere/mcp-db --host sqlite:///./relative/path/db.db
```

**PostgreSQL connection refused:**
- Verify the database is running: `pg_isready -h localhost`
- Check connection string format
- Ensure network access (firewall, security groups)

### Permission Errors

**"Write operations disabled":**
```bash
# Enable writes (both server AND request must allow)
npx @amusphere/mcp-db --host sqlite:///./dev.db --allow-writes
```

**"Table not allowlisted":**
```bash
# Add tables to allowlist
npx @amusphere/mcp-db --host sqlite:///./dev.db --allowlist users,posts
```

### Performance Issues

**Queries timing out:**
```bash
# Increase timeout
npx @amusphere/mcp-db --host sqlite:///./dev.db --timeout 60
```

**Too much data returned:**
```bash
# Reduce row limit
npx @amusphere/mcp-db --host sqlite:///./dev.db --max-rows 100
```

### MCP Client Configuration

**Server not appearing in Claude Desktop:**
1. Check config file location: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
2. Verify JSON syntax is valid
3. Restart Claude Desktop completely

**Codex not connecting:**
1. Check `~/.codex/mcp.toml` syntax
2. Ensure `npx` is in PATH
3. Try running command manually first

## Docker Deployment

### Using Docker Compose

```bash
# Start the server with PostgreSQL
docker-compose up --build

# Access at http://localhost:8080 (HTTP mode)
```

### Standalone Container

```bash
# Build
docker build -t mcp-db:latest .

# Run with SQLite (mount volume for persistence)
docker run --rm \
  -v $(pwd)/data:/data \
  -e DB_URL='sqlite:////data/mydb.db' \
  mcp-db:latest

# Run with PostgreSQL
docker run --rm \
  -e DB_URL='postgresql://user:pass@host:5432/db' \
  -e ALLOW_WRITES=false \
  mcp-db:latest
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
git clone https://github.com/amusphere/mcp-db.git
cd mcp-db
npm install
npm run dev  # Start development server
npm run lint # Run linter
npm run typecheck # Type checking
```

## License

MIT License - see [LICENSE](LICENSE) file for details

## Support

- 📖 [Documentation](https://github.com/amusphere/mcp-db)
- 🐛 [Issue Tracker](https://github.com/amusphere/mcp-db/issues)
- 💬 [Discussions](https://github.com/amusphere/mcp-db/discussions)

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/) - Official MCP documentation
- [MCP Servers](https://github.com/modelcontextprotocol/servers) - Collection of MCP servers
- [Claude Desktop](https://claude.ai/download) - AI assistant with MCP support

---

**Made with ❤️ for the MCP community**
