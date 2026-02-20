/**
 * Launches VS Code with the extension loaded and runs the integration tests.
 *
 * Usage: npx tsx src/test/runTest.ts
 */

import { runTests } from "@vscode/test-electron";
import { resolve } from "node:path";

async function main() {
  const extensionDevelopmentPath = resolve(__dirname, "../../");
  const extensionTestsPath = resolve(__dirname, "./suite/index");
  const testWorkspace = resolve(__dirname, "../../test-fixtures");

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        testWorkspace,
        "--disable-extensions",
        "--disable-gpu",
      ],
    });
  } catch (err) {
    console.error("Failed to run tests:", err);
    process.exit(1);
  }
}

main();
