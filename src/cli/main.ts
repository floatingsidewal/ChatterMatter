#!/usr/bin/env node

/**
 * ChatterMatter CLI — chattermatter add, list, resolve, strip, review
 */

import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadBlocks,
  listBlocks,
  addComment,
  resolveBlock,
  getCleanContent,
  validate,
  buildThreads,
} from "../document.js";
import type { BlockType, ThreadNode } from "../types.js";
import type { FilterOptions } from "../document.js";
import { BLOCK_TYPES } from "../types.js";

const program = new Command();

program
  .name("chattermatter")
  .description("Track changes and comments for Markdown")
  .version("0.1.0");

// ---------------------------------------------------------------------------
// chattermatter add
// ---------------------------------------------------------------------------
program
  .command("add")
  .description("Add a comment to a Markdown file")
  .argument("<file>", "Markdown file to annotate")
  .requiredOption("-c, --content <text>", "Comment text")
  .option("-t, --type <type>", "Block type (comment, question, suggestion, ai_feedback, reaction)", "comment")
  .option("-a, --author <name>", "Author name")
  .option("--anchor <text>", "Text to anchor the comment to")
  .option("--parent <id>", "Parent block ID (for threading)")
  .option("--sidecar", "Write to sidecar file instead of inline")
  .action(async (file: string, opts) => {
    const filePath = resolve(file);
    const markdown = await readFile(filePath, "utf-8");

    if (opts.type && !(BLOCK_TYPES as readonly string[]).includes(opts.type)) {
      console.error(`Error: unknown type "${opts.type}". Valid types: ${BLOCK_TYPES.join(", ")}`);
      process.exit(1);
    }

    const anchor = opts.anchor
      ? { type: "text" as const, exact: opts.anchor }
      : undefined;

    const { markdown: updated, block } = addComment(markdown, {
      content: opts.content,
      type: opts.type as BlockType,
      author: opts.author,
      anchor,
      parent_id: opts.parent,
    });

    const targetPath = opts.sidecar ? filePath + ".chatter" : filePath;

    if (opts.sidecar) {
      // Append to sidecar file
      let sidecarContent = "";
      try {
        sidecarContent = await readFile(targetPath, "utf-8");
      } catch {
        // Sidecar doesn't exist yet
      }
      const { appendBlock } = await import("../serializer.js");
      const newContent = sidecarContent
        ? appendBlock(sidecarContent, block)
        : "```chattermatter\n" + JSON.stringify(block, null, 2) + "\n```\n";
      await writeFile(targetPath, newContent, "utf-8");
    } else {
      await writeFile(targetPath, updated, "utf-8");
    }

    console.log(`Added ${block.type} [${block.id.slice(0, 8)}...] to ${targetPath}`);
  });

// ---------------------------------------------------------------------------
// chattermatter list
// ---------------------------------------------------------------------------
program
  .command("list")
  .description("List comments in a Markdown file")
  .argument("<file>", "Markdown file to read")
  .option("-t, --type <type>", "Filter by type")
  .option("-s, --status <status>", "Filter by status (open, resolved)")
  .option("-a, --author <name>", "Filter by author")
  .option("--threads", "Display as threaded tree")
  .option("--json", "Output as JSON")
  .option("--sidecar", "Also read from sidecar file")
  .action(async (file: string, opts) => {
    const filePath = resolve(file);
    let markdown = await readFile(filePath, "utf-8");

    // Merge sidecar if requested
    if (opts.sidecar) {
      try {
        const sidecar = await readFile(filePath + ".chatter", "utf-8");
        markdown = markdown + "\n\n" + sidecar;
      } catch {
        // No sidecar
      }
    }

    const filters: FilterOptions = {};
    if (opts.type) filters.type = opts.type as BlockType;
    if (opts.status) filters.status = opts.status;
    if (opts.author) filters.author = opts.author;

    const blocks = listBlocks(markdown, filters);

    if (blocks.length === 0) {
      console.log("No comments found.");
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(blocks, null, 2));
      return;
    }

    if (opts.threads) {
      const trees = buildThreads(blocks);
      for (const tree of trees) {
        printThread(tree, 0);
      }
      return;
    }

    for (const block of blocks) {
      printBlock(block);
    }
  });

// ---------------------------------------------------------------------------
// chattermatter resolve
// ---------------------------------------------------------------------------
program
  .command("resolve")
  .description("Mark a comment as resolved")
  .argument("<file>", "Markdown file")
  .requiredOption("-i, --id <id>", "Block ID to resolve (prefix match supported)")
  .action(async (file: string, opts) => {
    const filePath = resolve(file);
    const markdown = await readFile(filePath, "utf-8");

    // Support prefix matching for IDs (UUIDs are long)
    const { blocks } = loadBlocks(markdown);
    const match = blocks.find((pb) =>
      pb.block.id === opts.id || pb.block.id.startsWith(opts.id)
    );

    if (!match) {
      console.error(`Error: no block found matching id "${opts.id}"`);
      process.exit(1);
    }

    if (match.block.status === "resolved") {
      console.log(`Block [${match.block.id.slice(0, 8)}...] is already resolved.`);
      return;
    }

    const updated = resolveBlock(markdown, match.block.id);
    await writeFile(filePath, updated, "utf-8");
    console.log(`Resolved [${match.block.id.slice(0, 8)}...] "${match.block.content.slice(0, 60)}"`);
  });

// ---------------------------------------------------------------------------
// chattermatter strip
// ---------------------------------------------------------------------------
program
  .command("strip")
  .description("Produce a clean Markdown file with all ChatterMatter blocks removed")
  .argument("<file>", "Markdown file")
  .option("-o, --output <file>", "Output file (defaults to stdout)")
  .action(async (file: string, opts) => {
    const filePath = resolve(file);
    const markdown = await readFile(filePath, "utf-8");
    const clean = getCleanContent(markdown);

    if (opts.output) {
      await writeFile(resolve(opts.output), clean, "utf-8");
      console.error(`Stripped output written to ${opts.output}`);
    } else {
      process.stdout.write(clean);
    }
  });

// ---------------------------------------------------------------------------
// chattermatter validate
// ---------------------------------------------------------------------------
program
  .command("validate")
  .description("Validate ChatterMatter blocks in a Markdown file")
  .argument("<file>", "Markdown file")
  .action(async (file: string) => {
    const filePath = resolve(file);
    const markdown = await readFile(filePath, "utf-8");
    const result = validate(markdown);

    if (result.valid) {
      const { blocks } = loadBlocks(markdown);
      console.log(`Valid. ${blocks.length} block(s) found.`);
    } else {
      console.error(`Validation failed with ${result.errors.length} error(s):`);
      for (const err of result.errors) {
        console.error(`  [${err.blockId}] ${err.field}: ${err.message}`);
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// chattermatter review
// ---------------------------------------------------------------------------
program
  .command("review")
  .description("AI-powered document review using Claude")
  .argument("<file>", "Markdown file to review")
  .option("-m, --model <model>", "Claude model to use", "claude-sonnet-4-20250514")
  .option("-a, --author <name>", "Author name for AI blocks", "ai-reviewer")
  .option("--instructions <text>", "Custom review instructions")
  .option("--sidecar", "Write blocks to sidecar file instead of inline")
  .option("--dry-run", "Print blocks to stdout without writing to file")
  .option("--json", "Output blocks as JSON (implies --dry-run)")
  .action(async (file: string, opts) => {
    const filePath = resolve(file);
    const markdown = await readFile(filePath, "utf-8");

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
      console.error("Set it with: export ANTHROPIC_API_KEY=your-key-here");
      process.exit(1);
    }

    const { reviewDocument, formatReviewSummary } = await import("../reviewer.js");
    const { serializeBlocks, appendBlock } = await import("../serializer.js");

    console.error(`Reviewing ${file} with ${opts.model}...`);

    const result = await reviewDocument({
      markdown,
      model: opts.model,
      author: opts.author,
      instructions: opts.instructions,
    });

    if (result.blocks.length === 0) {
      console.log("No issues found.");
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(result.blocks, null, 2));
      return;
    }

    if (opts.dryRun) {
      console.log(formatReviewSummary(result.blocks));
      return;
    }

    // Write blocks to file
    const targetPath = opts.sidecar ? filePath + ".chatter" : filePath;

    if (opts.sidecar) {
      let sidecarContent = "";
      try {
        sidecarContent = await readFile(targetPath, "utf-8");
      } catch {
        // Sidecar doesn't exist yet
      }
      let content = sidecarContent;
      for (const block of result.blocks) {
        content = content
          ? appendBlock(content, block)
          : "```chattermatter\n" + JSON.stringify(block, null, 2) + "\n```\n";
      }
      await writeFile(targetPath, content, "utf-8");
    } else {
      let updated = markdown;
      for (const block of result.blocks) {
        updated = appendBlock(updated, block);
      }
      await writeFile(filePath, updated, "utf-8");
    }

    console.log(formatReviewSummary(result.blocks));
    console.log(`Wrote ${result.blocks.length} block(s) to ${targetPath}`);
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printBlock(block: import("../types.js").Block, indent = 0): void {
  const prefix = " ".repeat(indent);
  const status = block.status === "resolved" ? "[resolved]" : "[open]";
  const id = block.id.length > 8 ? block.id.slice(0, 8) + "..." : block.id;
  const author = block.author ? ` @${block.author}` : "";
  const type = block.type;

  console.log(`${prefix}${status} ${type} ${id}${author}`);
  console.log(`${prefix}  ${block.content.slice(0, 120)}`);
  if (block.anchor) {
    const anchorDesc =
      block.anchor.type === "text"
        ? `"${block.anchor.exact}"`
        : block.anchor.type === "heading"
          ? `heading: "${(block.anchor as any).text}"`
          : `block #${(block.anchor as any).index}`;
    console.log(`${prefix}  anchor: ${anchorDesc}`);
  }
  console.log();
}

function printThread(node: ThreadNode, depth: number): void {
  printBlock(node.block, depth * 2);
  for (const child of node.children) {
    printThread(child, depth + 1);
  }
}

program.parse();
