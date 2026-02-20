/**
 * Test suite entry point — runs inside the VS Code process.
 *
 * Uses a simple assertion pattern since we're inside VS Code's
 * extension host, not a standard test runner.
 */

import * as path from "node:path";
import { glob } from "node:fs";

export async function run(): Promise<void> {
  // Import and run all test files
  const testsRoot = path.resolve(__dirname, ".");

  // Run each test module
  const testModules = [
    "./extension.test",
  ];

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const mod of testModules) {
    try {
      const tests = await import(mod);
      if (typeof tests.run === "function") {
        const results = await tests.run();
        passed += results.passed;
        failed += results.failed;
        failures.push(...results.failures);
      }
    } catch (err) {
      failed++;
      failures.push(`${mod}: ${err}`);
    }
  }

  console.log(`\nTest Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.error("\nFailures:");
    for (const f of failures) {
      console.error(`  - ${f}`);
    }
    throw new Error(`${failed} test(s) failed`);
  }
}
