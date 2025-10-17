# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the TypeScript sources for:
  - `config.ts` - Configuration management from env vars and CLI args
  - `sqlGuard.ts` - SQL validation and security enforcement
  - `db.ts` - Database connection and query execution (SQLite/PostgreSQL/MySQL/MariaDB)
  - `mcp-server.ts` - MCP stdio server implementation (primary)
  - `http-server.ts` - HTTP server implementation (legacy/optional)
  - `routes.ts` - HTTP route handlers
  - `index.ts` - Entry point and mode router (stdio vs HTTP)
- `tests/` contains comprehensive test suites for all supported databases:
  - `test-sqlite.ts` - SQLite in-memory tests
  - `test-postgres.ts` - PostgreSQL integration tests
  - `test-mysql.ts` - MySQL integration tests
  - `test-mariadb.ts` - MariaDB integration tests
  - `run-all-tests.ts` - Test orchestrator
  - `README.md` - Detailed testing documentation
- `.github/workflows/` contains CI/CD configurations:
  - `ci.yml` - GitHub Actions workflow for lint, typecheck, build, and test
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

## Build, Test, and Development Commands
```bash
npm install            # install dependencies
npm run build          # transpile TypeScript to dist/
npm run dev            # hot-reload development server via tsx
npm start              # run the MCP stdio server from dist/
npm run lint           # eslint over all TypeScript sources
npm run typecheck      # strict tsc pass without emitting files

# Testing commands
npm test               # run all database tests (requires Docker for PostgreSQL/MySQL/MariaDB)
npm run test:docker    # run all tests in Docker (recommended - auto cleanup)
npm run test:sqlite    # run SQLite tests only (no Docker required)
npm run test:postgres  # run PostgreSQL tests (requires running PostgreSQL container)
npm run test:mysql     # run MySQL tests (requires running MySQL container)
npm run test:mariadb   # run MariaDB tests (requires running MariaDB container)
```

### Testing
```bash
# Recommended: Run all tests in Docker with auto cleanup
npm run test:docker

# Or manually manage Docker containers
docker compose up -d postgres mysql mariadb  # Start databases
npm test                                     # Run all test suites
docker compose down -v                       # Stop and clean up

# Run individual test suites
npm run test:sqlite      # SQLite (in-memory, no Docker needed)
npm run test:postgres    # PostgreSQL tests
npm run test:mysql       # MySQL tests
npm run test:mariadb     # MariaDB tests

# Manual testing via MCP stdio mode
node dist/index.js --host sqlite:///./dev.db

# Test HTTP mode
node dist/index.js --host sqlite:///./dev.db --http-mode --port 8080

# Clean up Docker resources
docker-compose down -v
```

See [tests/README.md](tests/README.md) for comprehensive testing documentation.

## Coding Style & Naming Conventions
- TypeScript code follows 2-space indentation and ES module syntax (`type: "module"` in `package.json`).
- Prefer descriptive camelCase for variables/functions and PascalCase for exported types or enums.
- Run `npm run lint` before sending reviews; the repo uses `@typescript-eslint` rules with Prettier compatibility to enforce formatting.
- Favor small, pure helpers in `src/` and keep request-handling logic inside `routes.ts`.

## Testing Guidelines
- Automated test suites are available in the `tests/` directory for all supported databases
- Each test suite covers: URL normalization, table operations, CRUD operations, query features, and database-specific features
- Tests use Docker containers for PostgreSQL, MySQL, and MariaDB; SQLite uses in-memory database
- Run tests before committing changes: `npm test`
- For SQL guard changes, validate via automated tests and manual `db_execute` tool testing
- Test both MCP stdio mode (default) and HTTP mode (`--http-mode`)
- All tests automatically clean up their data (drop test tables)
- See [tests/README.md](tests/README.md) for detailed testing procedures and troubleshooting
- **CI/CD**: GitHub Actions automatically runs lint, typecheck, build, and all tests on push/PR
  - Workflow file: `.github/workflows/ci.yml`
  - Tests run against PostgreSQL 16, MySQL 8.0, MariaDB 11.2 in service containers
  - All checks must pass before merging

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
