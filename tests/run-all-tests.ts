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

type TestResult = {
  name: string;
  passed: boolean;
  error?: string;
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

const results: TestResult[] = [];

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
    results.push({ name: test.name, passed: true });
  } catch (error) {
    console.log(`\n❌ ${test.name} tests failed`);
    results.push({
      name: test.name,
      passed: false,
      error: error instanceof Error ? error.message : String(error)
    });
    // Continue to next test instead of stopping
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log("Final Summary");
console.log("=".repeat(60));

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;

console.log(`\nTotal: ${results.length} test suites`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);

if (failed > 0) {
  console.log(`\nFailed test suites:`);
  results.filter((r) => !r.passed).forEach((r) => {
    console.log(`  - ${r.name}`);
  });
}

// Force flush stdout and stderr
if (process.stdout.isTTY) {
  process.stdout.write("");
}
if (process.stderr.isTTY) {
  process.stderr.write("");
}

if (failed === 0) {
  console.log("\n🎉 All tests passed!");
  // Give a moment for output to flush
  setTimeout(() => process.exit(0), 100);
} else {
  console.log(`\n❌ ${failed} test suite(s) failed`);
  // Give a moment for output to flush
  setTimeout(() => process.exit(1), 100);
}
