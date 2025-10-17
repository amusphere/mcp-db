#!/usr/bin/env tsx
/**
 * SQLite Database Tests
 * Tests basic operations against an in-memory SQLite database
 */

import { normalizeDatabaseUrl, listTables, describeTable, executeSql, explainQuery } from "../src/db.js";
import { DatabaseError } from "../src/db.js";

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

async function testSQLite() {
  console.log("\n=== SQLite Tests ===\n");

  const config = normalizeDatabaseUrl("sqlite:///:memory:");

  try {
    // Test 1: URL Normalization
    try {
      if (config.driver !== "sqlite") {
        throw new Error(`Expected driver 'sqlite', got '${config.driver}'`);
      }
      if (config.sqlitePath !== ":memory:") {
        throw new Error(`Expected path ':memory:', got '${config.sqlitePath}'`);
      }
      logTest("URL normalization", true);
    } catch (error) {
      logTest("URL normalization", false, (error as Error).message);
    }

    // Test 2: Create test table
    try {
      await executeSql(
        config,
        "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)",
        undefined,
        false,
        500
      );
      logTest("Create table", true);
    } catch (error) {
      logTest("Create table", false, (error as Error).message);
      return; // Cannot continue without table
    }

    // Test 3: Insert data
    try {
      const result = await executeSql(
        config,
        "INSERT INTO users (name, email) VALUES (:name, :email)",
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

    // Test 4: Insert more data
    try {
      await executeSql(
        config,
        "INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')",
        undefined,
        false,
        500
      );
      logTest("Insert without parameters", true);
    } catch (error) {
      logTest("Insert without parameters", false, (error as Error).message);
    }

    // Test 5: List tables
    try {
      const tables = await listTables(config);
      if (tables.includes("users")) {
        logTest("List tables", true);
      } else {
        logTest("List tables", false, "Table 'users' not found");
      }
    } catch (error) {
      logTest("List tables", false, (error as Error).message);
    }

    // Test 6: Describe table
    try {
      const columns = await describeTable(config, "users");
      if (columns.length === 3 && columns.some((c) => c.column_name === "name")) {
        logTest("Describe table", true);
      } else {
        logTest("Describe table", false, "Unexpected column structure");
      }
    } catch (error) {
      logTest("Describe table", false, (error as Error).message);
    }

    // Test 7: Select data
    try {
      const result = await executeSql(config, "SELECT * FROM users ORDER BY id", undefined, true, 500);
      if ("rows" in result && result.rows.length === 2) {
        logTest("SELECT query", true);
      } else {
        logTest("SELECT query", false, "Expected 2 rows");
      }
    } catch (error) {
      logTest("SELECT query", false, (error as Error).message);
    }

    // Test 8: SELECT with parameters
    try {
      const result = await executeSql(
        config,
        "SELECT * FROM users WHERE name = :name",
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

    // Test 9: Update data
    try {
      const result = await executeSql(
        config,
        "UPDATE users SET email = :email WHERE name = :name",
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

    // Test 10: EXPLAIN query
    try {
      const result = await explainQuery(config, "SELECT * FROM users WHERE name = :name", { name: "Alice" }, false);
      if (result.plan && Array.isArray(result.plan)) {
        logTest("EXPLAIN query", true);
      } else {
        logTest("EXPLAIN query", false, "Unexpected plan structure");
      }
    } catch (error) {
      logTest("EXPLAIN query", false, (error as Error).message);
    }

    // Test 11: Row limit
    try {
      await executeSql(config, "INSERT INTO users (name, email) VALUES ('Charlie', 'charlie@example.com')", undefined, false, 500);
      const result = await executeSql(config, "SELECT * FROM users", undefined, true, 2);
      if ("rows" in result && result.rows.length === 2 && result.truncated === true) {
        logTest("Row limit enforcement", true);
      } else {
        logTest("Row limit enforcement", false, "Expected 2 rows with truncated=true");
      }
    } catch (error) {
      logTest("Row limit enforcement", false, (error as Error).message);
    }

    // Test 12: DELETE query
    try {
      const result = await executeSql(
        config,
        "DELETE FROM users WHERE name = :name",
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
  } catch (error) {
    console.error("Unexpected error:", error);
  }
}

async function main() {
  await testSQLite();

  console.log("\n=== Test Summary ===");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${results.length}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
