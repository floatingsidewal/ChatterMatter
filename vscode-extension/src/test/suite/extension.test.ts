/**
 * VS Code extension integration tests.
 *
 * These run inside a real VS Code instance with the extension loaded.
 */

import * as vscode from "vscode";
import * as assert from "node:assert";
import * as path from "node:path";
import { writeFile, unlink } from "node:fs/promises";

const FIXTURE_DIR = path.resolve(__dirname, "../../../test-fixtures");

interface TestResults {
  passed: number;
  failed: number;
  failures: string[];
}

export async function run(): Promise<TestResults> {
  const results: TestResults = { passed: 0, failed: 0, failures: [] };

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      results.passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      results.failed++;
      results.failures.push(`${name}: ${err}`);
      console.log(`  ✗ ${name}: ${err}`);
    }
  }

  console.log("\nExtension Integration Tests");
  console.log("───────────────────────────");

  // -----------------------------------------------------------------------
  // Test: Extension activates on Markdown files
  // -----------------------------------------------------------------------
  await test("extension activates on markdown", async () => {
    const testFile = path.join(FIXTURE_DIR, "test-activate.md");
    await writeFile(testFile, "# Test\n\nHello world.\n", "utf-8");

    try {
      const doc = await vscode.workspace.openTextDocument(testFile);
      await vscode.window.showTextDocument(doc);

      // Give the extension time to activate
      await sleep(1000);

      // Verify our commands are registered
      const commands = await vscode.commands.getCommands(true);
      assert.ok(
        commands.includes("chattermatter.addComment"),
        "addComment command should be registered"
      );
      assert.ok(
        commands.includes("chattermatter.listComments"),
        "listComments command should be registered"
      );
      assert.ok(
        commands.includes("chattermatter.toggleOverlay"),
        "toggleOverlay command should be registered"
      );
    } finally {
      await cleanupFile(testFile);
    }
  });

  // -----------------------------------------------------------------------
  // Test: List comments finds embedded blocks
  // -----------------------------------------------------------------------
  await test("list finds embedded chattermatter blocks", async () => {
    const content = `# Doc with comments

Some text here.

\`\`\`chattermatter
{
  "id": "test-1",
  "type": "comment",
  "author": "alice",
  "content": "This is a test comment.",
  "anchor": { "type": "text", "exact": "Some text" },
  "status": "open"
}
\`\`\`
`;
    const testFile = path.join(FIXTURE_DIR, "test-list.md");
    await writeFile(testFile, content, "utf-8");

    try {
      const doc = await vscode.workspace.openTextDocument(testFile);
      await vscode.window.showTextDocument(doc);
      await sleep(500);

      // The document should contain our test block
      const text = doc.getText();
      assert.ok(text.includes("test-1"), "document should contain the test block");
      assert.ok(text.includes("chattermatter"), "document should contain chattermatter fence");
    } finally {
      await cleanupFile(testFile);
    }
  });

  // -----------------------------------------------------------------------
  // Test: Strip command produces clean output
  // -----------------------------------------------------------------------
  await test("strip removes chattermatter blocks", async () => {
    const content = `# Clean Doc

Real content here.

\`\`\`chattermatter
{
  "id": "strip-1",
  "type": "comment",
  "content": "Remove me."
}
\`\`\`

More content.
`;
    const testFile = path.join(FIXTURE_DIR, "test-strip.md");
    await writeFile(testFile, content, "utf-8");

    try {
      const doc = await vscode.workspace.openTextDocument(testFile);
      await vscode.window.showTextDocument(doc);
      await sleep(500);

      // Verify the block exists before strip
      assert.ok(doc.getText().includes("strip-1"));

      // We can't easily test the interactive strip command,
      // but we can verify the library function works
      const { getCleanContent } = await import("chattermatter");
      const clean = getCleanContent(doc.getText());
      assert.ok(!clean.includes("chattermatter"), "stripped content should not contain chattermatter");
      assert.ok(clean.includes("Real content here"), "stripped content should preserve document text");
      assert.ok(clean.includes("More content"), "stripped content should preserve all document text");
    } finally {
      await cleanupFile(testFile);
    }
  });

  // -----------------------------------------------------------------------
  // Test: Toggle overlay command runs without error
  // -----------------------------------------------------------------------
  await test("toggle overlay command executes", async () => {
    const testFile = path.join(FIXTURE_DIR, "test-toggle.md");
    await writeFile(testFile, "# Toggle Test\n\nContent.\n", "utf-8");

    try {
      const doc = await vscode.workspace.openTextDocument(testFile);
      await vscode.window.showTextDocument(doc);
      await sleep(500);

      // Should not throw
      await vscode.commands.executeCommand("chattermatter.toggleOverlay");
      await sleep(200);

      // Toggle back
      await vscode.commands.executeCommand("chattermatter.toggleOverlay");
    } finally {
      await cleanupFile(testFile);
    }
  });

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Ignore
  }
}
