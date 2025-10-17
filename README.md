# MCP Database Server

[![npm version](https://img.shields.io/npm/v/@amusphere/mcp-db.svg)](https://www.npmjs.com/package/@amusphere/mcp-db)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server that provides secure database access for AI assistants and LLM-based tools. Query SQLite and PostgreSQL databases with built-in safety controls, query validation, and audit logging.

## Features

- 🔒 **Secure by Default**: Read-only mode with granular permission controls
- 🗄️ **Multi-Database**: Support for SQLite and PostgreSQL
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
npx @amusphere/mcp-db --host sqlite:///./dev.db
```

### Configuration for MCP Clients

#### Codex CLI

Add to your Codex configuration file (`~/.codex/mcp.toml` or similar):

```toml
[mcp_servers.mcp-db]
command = "npx"
args = ["-y", "@amusphere/mcp-db", "--host", "sqlite:///./dev.db"]
```

#### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "mcp-db": {
      "command": "npx",
      "args": ["-y", "@amusphere/mcp-db", "--host", "sqlite:///./dev.db"]
    }
  }
}
```

#### PostgreSQL Example

```toml
[mcp_servers.mcp-db]
command = "npx"
args = [
  "-y",
  "@amusphere/mcp-db",
  "--host", "postgresql://user:password@localhost:5432/mydb"
]
```

## Usage Examples

### Command Line

#### SQLite Database

```bash
# Basic usage with SQLite
npx @amusphere/mcp-db --host sqlite:///./dev.db

# With write operations enabled
npx @amusphere/mcp-db --host sqlite:///./dev.db --allow-writes

# With table allowlist (only allow specific tables)
npx @amusphere/mcp-db --host sqlite:///./dev.db --allowlist users,posts,comments

# With custom limits
npx @amusphere/mcp-db --host sqlite:///./dev.db --max-rows 100 --timeout 30
```

#### PostgreSQL Database

```bash
# Basic usage
npx @amusphere/mcp-db --host postgresql://user:password@localhost:5432/mydb

# With schema-qualified allowlist
npx @amusphere/mcp-db \
  --host postgresql://user:password@localhost:5432/mydb \
  --allowlist public.users,public.posts
```

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
| `--host <url>` | Database connection URL (alias: `--db-url`) | `sqlite:///./dev.db` |
| `--allow-writes` | Enable INSERT/UPDATE/DELETE operations | `false` |
| `--allow-ddl` | Enable CREATE/ALTER/DROP operations | `false` |
| `--allowlist <tables>` | Comma-separated list of allowed tables | All tables |
| `--max-rows <number>` | Maximum rows to return for SELECT queries | `500` |
| `--timeout <seconds>` | Query timeout in seconds | `20` |
| `--http-mode` | Run as HTTP server instead of MCP stdio | `false` |
| `--port <number>` | Port for HTTP mode | `8080` |
| `--require-api-key` | Require X-API-Key header (HTTP mode only) | `false` |
| `--api-key <value>` | Expected API key value | - |

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

**PostgreSQL:**
```
postgresql://username:password@host:port/database
postgresql://localhost/mydb        # Local with defaults
```

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

This server provides three MCP tools for database operations:

### `db_tables`
List all tables in the database.

**Parameters:**
- `db_url` (optional): Override default database URL
- `schema` (optional): Filter by schema (PostgreSQL only)

**Example:**
```json
{
  "db_url": "sqlite:///./dev.db",
  "schema": "public"
}
```

### `db_describe_table`
Get column information for a specific table.

**Parameters:**
- `table` (required): Table name to describe
- `db_url` (optional): Override default database URL
- `schema` (optional): Schema name (PostgreSQL only)

**Example:**
```json
{
  "table": "users",
  "schema": "public"
}
```

### `db_execute`
Execute a SQL statement with safety controls.

**Parameters:**
- `sql` (required): SQL statement to execute
- `args` (optional): Named parameters (use `:param` syntax in SQL)
- `allow_write` (optional): Must be `true` for write operations
- `row_limit` (optional): Override default max rows
- `db_url` (optional): Override default database URL

**Example:**
```json
{
  "sql": "SELECT * FROM users WHERE status = :status LIMIT 10",
  "args": {
    "status": "active"
  }
}
```

## How AI Assistants Use These Tools

When you connect an AI assistant (like Claude or Codex) to this MCP server, it can:

1. **Explore your database structure**: "What tables are in my database?"
2. **Understand table schemas**: "Show me the columns in the users table"
3. **Query data**: "How many active users do we have?"
4. **Analyze data**: "What are the top 10 products by sales?"
5. **Generate insights**: "Find any duplicate email addresses in the users table"

The AI assistant will automatically use the appropriate tool and construct safe SQL queries based on your natural language requests.

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
