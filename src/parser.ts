/**
 * ChatterMatter parser — extracts blocks from Markdown content.
 *
 * Handles both fenced code block encoding (§3.1) and HTML comment encoding (§3.2).
 */

import type { Block, ParsedBlock, ParseResult, ParseWarning } from "./types.js";

// Match ```chattermatter ... ``` fenced code blocks.
// Handles both ``` and ~~~ fence styles, with optional trailing text after the language tag.
const FENCED_BLOCK_RE =
  /^(```|~~~)chattermatter[ \t]*\r?\n([\s\S]*?)\r?\n\1\s*$/gm;

// Match <!--chattermatter { ... } --> HTML comment blocks.
const HTML_COMMENT_RE = /<!--chattermatter\s+([\s\S]*?)\s*-->/g;

/**
 * Parse all ChatterMatter blocks from a Markdown string.
 *
 * Returns parsed blocks and any warnings (malformed JSON, missing fields, etc.).
 * Per the spec (§12), malformed or invalid blocks are skipped with warnings — never thrown.
 */
export function parse(markdown: string): ParseResult {
  const blocks: ParsedBlock[] = [];
  const warnings: ParseWarning[] = [];
  let documentIndex = 0;

  // --- Fenced code blocks (§3.1) ---
  for (const match of markdown.matchAll(FENCED_BLOCK_RE)) {
    const jsonStr = match[2];
    const startOffset = match.index!;
    const endOffset = startOffset + match[0].length;

    const result = tryParseBlock(jsonStr, startOffset, endOffset, documentIndex, warnings);
    if (result) {
      blocks.push(result);
      documentIndex++;
    }
  }

  // --- HTML comment blocks (§3.2) ---
  for (const match of markdown.matchAll(HTML_COMMENT_RE)) {
    const jsonStr = match[1];

    // §3.2 constraint: ignore if payload contains "-->"
    if (jsonStr.includes("-->")) {
      warnings.push({
        message: "HTML comment block contains '-->'; ignoring per §3.2",
        source: match[0],
      });
      continue;
    }

    const startOffset = match.index!;
    const endOffset = startOffset + match[0].length;

    const result = tryParseBlock(jsonStr, startOffset, endOffset, documentIndex, warnings);
    if (result) {
      blocks.push(result);
      documentIndex++;
    }
  }

  // Sort by document order (startOffset) in case fenced and HTML blocks are interleaved.
  blocks.sort((a, b) => a.startOffset - b.startOffset);
  // Re-assign documentIndex after sorting.
  blocks.forEach((b, i) => {
    b.documentIndex = i;
  });

  return { blocks, warnings };
}

/**
 * Attempt to parse a JSON string into a Block.
 * Returns null and pushes a warning if the JSON is malformed or missing required fields.
 */
function tryParseBlock(
  jsonStr: string,
  startOffset: number,
  endOffset: number,
  documentIndex: number,
  warnings: ParseWarning[],
): ParsedBlock | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    warnings.push({
      message: `Malformed JSON: ${jsonStr.slice(0, 80)}...`,
      source: jsonStr,
    });
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warnings.push({
      message: "ChatterMatter block must be a JSON object",
      source: jsonStr,
    });
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Check required fields (§4.1, §12)
  const missing: string[] = [];
  if (typeof obj.id !== "string" || obj.id === "") missing.push("id");
  if (typeof obj.type !== "string" || obj.type === "") missing.push("type");
  if (typeof obj.content !== "string" && obj.type !== "reaction") missing.push("content");

  if (missing.length > 0) {
    warnings.push({
      message: `Block missing required field(s): ${missing.join(", ")}`,
      source: jsonStr,
    });
    return null;
  }

  // Normalize: content defaults to "" for reactions if not provided
  if (obj.type === "reaction" && typeof obj.content !== "string") {
    obj.content = "";
  }

  return {
    block: obj as Block,
    documentIndex,
    startOffset,
    endOffset,
  };
}

/**
 * Extract only the plain Markdown content with all ChatterMatter blocks removed.
 * This is the "strip" operation (produces a clean document).
 */
export function stripBlocks(markdown: string): string {
  let result = markdown;

  // Remove fenced blocks
  result = result.replace(FENCED_BLOCK_RE, "");

  // Remove HTML comment blocks
  result = result.replace(HTML_COMMENT_RE, "");

  // Clean up excess blank lines left behind (collapse 3+ newlines to 2)
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim() + "\n";
}
