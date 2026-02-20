/**
 * ChatterMatter GitHub Action entrypoint.
 *
 * Reviews changed Markdown files in a PR using Claude and outputs
 * feedback as ChatterMatter blocks (inline, sidecar, or PR comment).
 */

import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// GitHub Actions core helpers (avoid extra dependency)
// ---------------------------------------------------------------------------

function getInput(name) {
  const val = process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "";
  return val.trim();
}

function setOutput(name, value) {
  const filePath = process.env.GITHUB_OUTPUT;
  if (filePath) {
    const fs = await import("node:fs");
    fs.appendFileSync(filePath, `${name}=${value}\n`);
  }
}

function warning(msg) {
  console.log(`::warning::${msg}`);
}

function error(msg) {
  console.log(`::error::${msg}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = getInput("anthropic_api_key");
  const model = getInput("model") || "claude-sonnet-4-20250514";
  const instructions = getInput("instructions");
  const mode = getInput("mode") || "comment";
  const filePattern = getInput("file_pattern") || "**/*.md";
  const excludePattern = getInput("exclude_pattern") || "node_modules/**";

  if (!apiKey) {
    error("anthropic_api_key input is required");
    process.exit(1);
  }

  process.env.ANTHROPIC_API_KEY = apiKey;

  // Get changed files from the PR
  const changedFiles = getChangedMarkdownFiles(filePattern, excludePattern);

  if (changedFiles.length === 0) {
    console.log("No Markdown files changed in this PR.");
    return;
  }

  console.log(`Reviewing ${changedFiles.length} file(s): ${changedFiles.join(", ")}`);

  // Dynamic import of the reviewer (will be built alongside the action)
  const { reviewDocument, formatReviewSummary } = await import("../dist/reviewer.js");
  const { appendBlock, serializeBlocks } = await import("../dist/serializer.js");

  let totalBlocks = 0;
  const allResults = [];

  for (const file of changedFiles) {
    const filePath = join(process.env.GITHUB_WORKSPACE || ".", file);

    if (!existsSync(filePath)) {
      warning(`File not found: ${file}`);
      continue;
    }

    const markdown = await readFile(filePath, "utf-8");

    console.log(`Reviewing ${file}...`);

    try {
      const result = await reviewDocument({
        markdown,
        model,
        instructions: instructions || undefined,
        apiKey,
      });

      if (result.blocks.length === 0) {
        console.log(`  No issues found in ${file}`);
        continue;
      }

      totalBlocks += result.blocks.length;
      allResults.push({ file, blocks: result.blocks });

      // Write blocks based on mode
      if (mode === "inline") {
        let updated = markdown;
        for (const block of result.blocks) {
          updated = appendBlock(updated, block);
        }
        await writeFile(filePath, updated, "utf-8");
        console.log(`  Wrote ${result.blocks.length} block(s) inline to ${file}`);
      } else if (mode === "sidecar") {
        const sidecarPath = filePath + ".chatter";
        let sidecarContent = "";
        try {
          sidecarContent = await readFile(sidecarPath, "utf-8");
        } catch {
          // No existing sidecar
        }
        let content = sidecarContent;
        for (const block of result.blocks) {
          content = content
            ? appendBlock(content, block)
            : "```chattermatter\n" + JSON.stringify(block, null, 2) + "\n```\n";
        }
        await writeFile(sidecarPath, content, "utf-8");
        console.log(`  Wrote ${result.blocks.length} block(s) to ${file}.chatter`);
      }
      // "comment" mode is handled below after all files are reviewed
    } catch (err) {
      warning(`Failed to review ${file}: ${err.message}`);
    }
  }

  // Post PR comment if mode is "comment"
  if (mode === "comment" && allResults.length > 0) {
    const commentBody = buildPRComment(allResults);
    postPRComment(commentBody);
  }

  // Commit changes if mode is "inline" or "sidecar"
  if ((mode === "inline" || mode === "sidecar") && totalBlocks > 0) {
    commitChanges(mode);
  }

  // Set outputs
  try {
    const fs = await import("node:fs");
    const outputPath = process.env.GITHUB_OUTPUT;
    if (outputPath) {
      fs.appendFileSync(outputPath, `blocks_count=${totalBlocks}\n`);
      fs.appendFileSync(outputPath, `files_reviewed=${changedFiles.length}\n`);
    }
  } catch {
    // Non-critical
  }

  console.log(`\nDone. Reviewed ${changedFiles.length} file(s), found ${totalBlocks} issue(s).`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getChangedMarkdownFiles(pattern, excludePattern) {
  try {
    // Get the base branch for comparison
    const eventPath = process.env.GITHUB_EVENT_PATH;
    let baseSha = "HEAD~1";

    if (eventPath) {
      try {
        const event = JSON.parse(readFileSync(eventPath, "utf-8"));
        if (event.pull_request?.base?.sha) {
          baseSha = event.pull_request.base.sha;
          // Fetch the base to make sure we have it
          try {
            execSync(`git fetch origin ${baseSha} --depth=1 2>/dev/null`, { stdio: "pipe" });
          } catch {
            // May already be available
          }
        }
      } catch {
        // Fall back to HEAD~1
      }
    }

    const diff = execSync(`git diff --name-only --diff-filter=ACMR ${baseSha} HEAD`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    return diff
      .split("\n")
      .filter((f) => f.trim())
      .filter((f) => f.endsWith(".md"))
      .filter((f) => !f.includes("node_modules/"))
      .filter((f) => !f.startsWith("."));
  } catch {
    // Fallback: find all .md files in the workspace
    try {
      const files = execSync('find . -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*"', {
        encoding: "utf-8",
      });
      return files.split("\n").filter((f) => f.trim()).map((f) => f.replace(/^\.\//, ""));
    } catch {
      return [];
    }
  }
}

function readFileSync(path, encoding) {
  const fs = require("node:fs");
  return fs.readFileSync(path, encoding);
}

function buildPRComment(results) {
  const lines = [];
  lines.push("## ChatterMatter AI Review\n");

  for (const { file, blocks } of results) {
    lines.push(`### ${file}\n`);

    for (const block of blocks) {
      const category = block.metadata?.category ?? "general";
      const confidence = block.metadata?.confidence ?? "medium";
      const anchor = block.anchor?.type === "text"
        ? `> ${block.anchor.exact.slice(0, 100)}${block.anchor.exact.length > 100 ? "..." : ""}\n\n`
        : "";

      lines.push(`**[${category}]** (${confidence} confidence)`);
      lines.push(anchor + block.content);
      lines.push("");
    }

    lines.push("---\n");
  }

  lines.push("*Generated by [ChatterMatter](https://github.com/floatingsidewal/ChatterMatter)*");

  return lines.join("\n");
}

function postPRComment(body) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    warning("GITHUB_TOKEN not available; skipping PR comment. Set permissions: pull-requests: write");
    console.log("\n--- Review Summary ---\n");
    console.log(body);
    return;
  }

  try {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) return;

    const event = JSON.parse(readFileSync(eventPath, "utf-8"));
    const prNumber = event.pull_request?.number;
    const repo = process.env.GITHUB_REPOSITORY;

    if (!prNumber || !repo) {
      console.log("\n--- Review Summary ---\n");
      console.log(body);
      return;
    }

    // Use gh CLI to post the comment
    execSync(`gh pr comment ${prNumber} --body "${body.replace(/"/g, '\\"')}"`, {
      env: { ...process.env, GH_TOKEN: token },
      stdio: "pipe",
    });

    console.log(`Posted review comment to PR #${prNumber}`);
  } catch (err) {
    warning(`Failed to post PR comment: ${err.message}`);
    console.log("\n--- Review Summary ---\n");
    console.log(body);
  }
}

function commitChanges(mode) {
  try {
    const patterns = mode === "sidecar" ? "*.chatter" : "*.md";
    execSync(`git add -A ${patterns}`, { stdio: "pipe" });

    const status = execSync("git status --porcelain", { encoding: "utf-8" });
    if (!status.trim()) return;

    execSync(
      'git -c user.name="ChatterMatter Bot" -c user.email="bot@chattermatter.dev" commit -m "chore: add AI review feedback"',
      { stdio: "pipe" }
    );

    execSync("git push", { stdio: "pipe" });
    console.log("Committed and pushed review feedback.");
  } catch (err) {
    warning(`Failed to commit changes: ${err.message}`);
  }
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
