#!/usr/bin/env tsx
/**
 * PostgreSQL Database Tests
 * Tests basic operations against a PostgreSQL database
 */

import { normalizeDatabaseUrl, listTables, describeTable, executeSql, explainQuery } from "../src/db.js";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function logTest(name: string, passed: boolean, error?: string) {
  results.push({ name, passed, error });
  const emoji = passed ? "✅" : "❌";
  console.log(`${emoji} ${name}`);
  if (error) {
    console.log(`   Error: ${error}`);
  }
}

async function testPostgreSQL() {
  console.log("\n=== PostgreSQL Tests ===\n");

  const dbUrl = process.env.POSTGRES_URL || "postgresql://mcp:password@localhost:5432/mcp";
  console.log(`Connecting to: ${dbUrl.replace(/:[^:@]+@/, ':***@')}\n`);

  const config = normalizeDatabaseUrl(dbUrl);

  try {
    // Test 1: URL Normalization
    try {
      if (config.driver !== "postgres") {
        throw new Error(`Expected driver 'postgres', got '${config.driver}'`);
      }
      logTest("URL normalization", true);
    } catch (error) {
      logTest("URL normalization", false, (error as Error).message);
    }

    // Test 2: Drop table if exists (cleanup)
    try {
      await executeSql(config, "DROP TABLE IF EXISTS test_users", undefined, false, 500);
      logTest("Cleanup existing table", true);
    } catch (error) {
      logTest("Cleanup existing table", false, (error as Error).message);
    }

    // Test 3: Create test table
    try {
      await executeSql(
        config,
        "CREATE TABLE test_users (id SERIAL PRIMARY KEY, name VARCHAR(100), email VARCHAR(100))",
        undefined,
        false,
        500
      );
      logTest("Create table", true);
    } catch (error) {
      logTest("Create table", false, (error as Error).message);
      return; // Cannot continue without table
    }

    // Test 4: Insert data with named parameters
    try {
      const result = await executeSql(
        config,
        "INSERT INTO test_users (name, email) VALUES (:name, :email)",
        { name: "Alice", email: "alice@example.com" },
        false,
        500
      );
      if ("rowcount" in result && result.rowcount === 1) {
        logTest("Insert with named parameters", true);
      } else {
        logTest("Insert with named parameters", false, "Expected rowcount 1");
      }
    } catch (error) {
      logTest("Insert with named parameters", false, (error as Error).message);
    }

    // Test 5: Insert more data
    try {
      await executeSql(
        config,
        "INSERT INTO test_users (name, email) VALUES ('Bob', 'bob@example.com'), ('Charlie', 'charlie@example.com')",
        undefined,
        false,
        500
      );
      logTest("Insert multiple rows", true);
    } catch (error) {
      logTest("Insert multiple rows", false, (error as Error).message);
    }

    // Test 6: List tables
    try {
      const tables = await listTables(config);
      if (tables.some((t) => t.includes("test_users"))) {
        logTest("List tables", true);
      } else {
        logTest("List tables", false, "Table 'test_users' not found");
      }
    } catch (error) {
      logTest("List tables", false, (error as Error).message);
    }

    // Test 7: List tables with schema filter
    try {
      const tables = await listTables(config, "public");
      if (tables.some((t) => t === "public.test_users")) {
        logTest("List tables with schema filter", true);
      } else {
        logTest("List tables with schema filter", false, "Table 'public.test_users' not found");
      }
    } catch (error) {
      logTest("List tables with schema filter", false, (error as Error).message);
    }

    // Test 8: Describe table
    try {
      const columns = await describeTable(config, "test_users");
      if (columns.length === 3 && columns.some((c) => c.column_name === "name")) {
        logTest("Describe table", true);
      } else {
        logTest("Describe table", false, "Unexpected column structure");
      }
    } catch (error) {
      logTest("Describe table", false, (error as Error).message);
    }

    // Test 9: Describe table with schema
    try {
      const columns = await describeTable(config, "public.test_users", "public");
      if (columns.length === 3) {
        logTest("Describe table with schema", true);
      } else {
        logTest("Describe table with schema", false, "Unexpected column structure");
      }
    } catch (error) {
      logTest("Describe table with schema", false, (error as Error).message);
    }

    // Test 10: SELECT query
    try {
      const result = await executeSql(config, "SELECT * FROM test_users ORDER BY id", undefined, true, 500);
      if ("rows" in result && result.rows.length === 3) {
        logTest("SELECT query", true);
      } else {
        logTest("SELECT query", false, `Expected 3 rows, got ${("rows" in result) ? result.rows.length : 0}`);
      }
    } catch (error) {
      logTest("SELECT query", false, (error as Error).message);
    }

    // Test 11: SELECT with named parameters
    try {
      const result = await executeSql(
        config,
        "SELECT * FROM test_users WHERE name = :name",
        { name: "Alice" },
        true,
        500
      );
      if ("rows" in result && result.rows.length === 1 && result.rows[0].name === "Alice") {
        logTest("SELECT with named parameters", true);
      } else {
        logTest("SELECT with named parameters", false, "Expected 1 row with name 'Alice'");
      }
    } catch (error) {
      logTest("SELECT with named parameters", false, (error as Error).message);
    }

    // Test 12: UPDATE query
    try {
      const result = await executeSql(
        config,
        "UPDATE test_users SET email = :email WHERE name = :name",
        { name: "Bob", email: "newemail@example.com" },
        false,
        500
      );
      if ("rowcount" in result && result.rowcount === 1) {
        logTest("UPDATE query", true);
      } else {
        logTest("UPDATE query", false, "Expected rowcount 1");
      }
    } catch (error) {
      logTest("UPDATE query", false, (error as Error).message);
    }

    // Test 13: EXPLAIN query
    try {
      const result = await explainQuery(
        config,
        "SELECT * FROM test_users WHERE name = :name",
        { name: "Alice" },
        false
      );
      if (result.plan && Array.isArray(result.plan)) {
        logTest("EXPLAIN query", true);
      } else {
        logTest("EXPLAIN query", false, "Unexpected plan structure");
      }
    } catch (error) {
      logTest("EXPLAIN query", false, (error as Error).message);
    }

    // Test 14: Row limit
    try {
      const result = await executeSql(config, "SELECT * FROM test_users", undefined, true, 2);
      if ("rows" in result && result.rows.length === 2 && result.truncated === true) {
        logTest("Row limit enforcement", true);
      } else {
        logTest("Row limit enforcement", false, "Expected 2 rows with truncated=true");
      }
    } catch (error) {
      logTest("Row limit enforcement", false, (error as Error).message);
    }

    // Test 15: DELETE query
    try {
      const result = await executeSql(
        config,
        "DELETE FROM test_users WHERE name = :name",
        { name: "Charlie" },
        false,
        500
      );
      if ("rowcount" in result && result.rowcount === 1) {
        logTest("DELETE query", true);
      } else {
        logTest("DELETE query", false, "Expected rowcount 1");
      }
    } catch (error) {
      logTest("DELETE query", false, (error as Error).message);
    }

    // Cleanup
    try {
      await executeSql(config, "DROP TABLE test_users", undefined, false, 500);
      logTest("Cleanup (drop table)", true);
    } catch (error) {
      logTest("Cleanup (drop table)", false, (error as Error).message);
    }
  } catch (error) {
    console.error("Unexpected error:", error);
  }
}

async function main() {
  await testPostgreSQL();

  console.log("\n=== Test Summary ===");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${results.length}`);

  if (failed > 0) {
    process.exit(1);
  }
  // Explicitly exit on success too
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
