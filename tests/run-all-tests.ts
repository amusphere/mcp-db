#!/usr/bin/env tsx
/**
 * Run all database tests
 */

import { execSync } from "child_process";

type TestConfig = {
  name: string;
  script: string;
  envVar?: string;
  defaultUrl?: string;
};

const tests: TestConfig[] = [
  { name: "SQLite", script: "npx tsx tests/test-sqlite.ts" },
  {
    name: "PostgreSQL",
    script: "npx tsx tests/test-postgres.ts",
    envVar: "POSTGRES_URL",
    defaultUrl: "postgresql://mcp:password@localhost:5432/mcp",
  },
  {
    name: "MySQL",
    script: "npx tsx tests/test-mysql.ts",
    envVar: "MYSQL_URL",
    defaultUrl: "mysql://mcp:password@localhost:3306/mcp",
  },
  {
    name: "MariaDB",
    script: "npx tsx tests/test-mariadb.ts",
    envVar: "MARIADB_URL",
    defaultUrl: "mariadb://mcp:password@localhost:3307/mcp",
  },
];

let allPassed = true;

console.log("=".repeat(60));
console.log("Running All Database Tests");
console.log("=".repeat(60));

for (const test of tests) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Running: ${test.name}`);
  console.log("=".repeat(60));

  try {
    const env = { ...process.env };
    if (test.envVar && test.defaultUrl && !env[test.envVar]) {
      // Fall back to the local URLs when nothing is provided (e.g. GitHub Actions).
      env[test.envVar] = test.defaultUrl;
    }

    execSync(test.script, { stdio: "inherit", shell: "/bin/sh", env });
    console.log(`\n✅ ${test.name} tests passed`);
  } catch (error) {
    console.log(`\n❌ ${test.name} tests failed`);
    allPassed = false;
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log("Final Summary");
console.log("=".repeat(60));

if (allPassed) {
  console.log("✅ All tests passed!");
  process.exit(0);
} else {
  console.log("❌ Some tests failed");
  process.exit(1);
}
