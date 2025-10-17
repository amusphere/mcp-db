# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the TypeScript sources for:
  - `config.ts` - Configuration management from env vars and CLI args
  - `sqlGuard.ts` - SQL validation and security enforcement
  - `db.ts` - Database connection and query execution (SQLite/PostgreSQL)
  - `mcp-server.ts` - MCP stdio server implementation (primary)
  - `http-server.ts` - HTTP server implementation (legacy/optional)
  - `routes.ts` - HTTP route handlers
  - `index.ts` - Entry point and mode router (stdio vs HTTP)
- `dist/` contains emitted JavaScript; edit only the TypeScript originals.
- Operational assets: `mcp.json` exposes MCP tool metadata, `openapi.yaml` documents HTTP API, `Dockerfile` / `docker-compose.yml` support container runs.
- Generated artifacts (logs, transient DB files) should stay outside the repo or be ignored via `.gitignore`.

## Build, Test, and Development Commands
```bash
npm install            # install dependencies
npm run build          # transpile TypeScript to dist/
npm run dev            # hot-reload development server via tsx
npm start              # run the MCP stdio server from dist/
npm run lint           # eslint over all TypeScript sources
npm run typecheck      # strict tsc pass without emitting files
```

### Testing
```bash
# Test MCP stdio mode (default)
node dist/index.js --host sqlite:///./dev.db

# Test HTTP mode
node dist/index.js --host sqlite:///./dev.db --http-mode --port 8080

# Docker testing
docker-compose up --build
```

## Coding Style & Naming Conventions
- TypeScript code follows 2-space indentation and ES module syntax (`type: "module"` in `package.json`).
- Prefer descriptive camelCase for variables/functions and PascalCase for exported types or enums.
- Run `npm run lint` before sending reviews; the repo uses `@typescript-eslint` rules with Prettier compatibility to enforce formatting.
- Favor small, pure helpers in `src/` and keep request-handling logic inside `routes.ts`.

## Testing Guidelines
- Manual testing via MCP stdio protocol or HTTP endpoints
- For SQL guard changes, validate via `db_execute` tool against both SQLite (`sqlite:///./dev.db`) and Postgres using `docker-compose`
- Test both MCP stdio mode (default) and HTTP mode (`--http-mode`)
- Capture regression scenarios in Markdown or issue comments; align scenario names with the affected module (e.g., `sqlGuard-allowlist-quoted`)

## MCP Tools (stdio mode)
The server exposes four MCP tools:
- `db_tables` - List all tables in the database
- `db_describe_table` - Get column information for a specific table
- `db_execute` - Execute SQL with safety controls (read/write/DDL)
- `db_explain` - Get query execution plan and performance information

## HTTP Endpoints (legacy --http-mode)
- `POST /tools/db.tables` - List tables
- `POST /tools/db.describe_table` - Describe table schema
- `POST /tools/db.execute` - Execute SQL query
- `POST /tools/db.explain` - Get query execution plan

## Commit & Pull Request Guidelines
- Follow Conventional Commit prefixes observed in history (e.g., `feat:`, `fix:`, `chore:`) and keep messages under ~72 characters.
- Link related issues in the PR body, summarize risk/rollback strategy, and note manual verification steps executed.
- Include configuration changes (`.env.example`, Docker files) in the same PR when they are required to exercise new functionality.

## Security & Configuration Tips
- Default runtime is read-only; document any decision to enable writes (`ALLOW_WRITES=true`) or DDL (`ALLOW_DDL=true`).
- Keep allowlists (`ALLOWLIST_TABLES`) schema-qualified to avoid overexposure, and update `sqlGuard.ts` whenever new parsing paths are introduced.
- When sharing examples, prefer parameters (`:name`) instead of literal values to avoid leaking sensitive strings in logs.
