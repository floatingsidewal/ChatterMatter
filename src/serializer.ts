/**
 * ChatterMatter serializer — writes blocks as fenced code blocks.
 *
 * Preserves all fields for round-trip fidelity (§9).
 */

import type { Block } from "./types.js";

/**
 * Serialize a block to a chattermatter fenced code block string.
 */
export function serializeBlock(block: Block): string {
  const json = JSON.stringify(block, null, 2);
  return "```chattermatter\n" + json + "\n```";
}

/**
 * Serialize multiple blocks, each in its own fenced code block,
 * separated by blank lines.
 */
export function serializeBlocks(blocks: Block[]): string {
  return blocks.map(serializeBlock).join("\n\n");
}

/**
 * Insert a serialized block into a Markdown document at the end.
 */
export function appendBlock(markdown: string, block: Block): string {
  const serialized = serializeBlock(block);
  const trimmed = markdown.trimEnd();
  return trimmed + "\n\n" + serialized + "\n";
}

/**
 * Remove a block by ID from a Markdown document.
 * Returns the modified markdown.
 */
export function removeBlock(markdown: string, blockId: string): string {
  // Match fenced blocks and check if they contain the target ID
  const fencedRe = /^(```|~~~)chattermatter[ \t]*\r?\n([\s\S]*?)\r?\n\1\s*$/gm;
  let result = markdown;

  for (const match of markdown.matchAll(fencedRe)) {
    try {
      const parsed = JSON.parse(match[2]);
      if (parsed && parsed.id === blockId) {
        // Remove the block and any surrounding blank lines
        result = result.replace(match[0], "");
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // Also check HTML comment blocks
  const htmlRe = /<!--chattermatter\s+([\s\S]*?)\s*-->/g;
  for (const match of markdown.matchAll(htmlRe)) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && parsed.id === blockId) {
        result = result.replace(match[0], "");
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // Clean up excess blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}

/**
 * Replace a block by ID in a Markdown document with an updated version.
 * If the block is not found, appends it.
 */
export function replaceBlock(markdown: string, updatedBlock: Block): string {
  const fencedRe = /^(```|~~~)chattermatter[ \t]*\r?\n([\s\S]*?)\r?\n\1\s*$/gm;
  let found = false;
  let result = markdown;

  for (const match of markdown.matchAll(fencedRe)) {
    try {
      const parsed = JSON.parse(match[2]);
      if (parsed && parsed.id === updatedBlock.id) {
        result = result.replace(match[0], serializeBlock(updatedBlock));
        found = true;
        break;
      }
    } catch {
      // Skip
    }
  }

  if (!found) {
    result = appendBlock(result, updatedBlock);
  }

  return result;
}
