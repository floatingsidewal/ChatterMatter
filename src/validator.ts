/**
 * ChatterMatter validator — validates blocks against the v0.1 spec.
 *
 * Covers type constraints (§4.3–4.6), anchor structure (§5), threading (§6),
 * ID uniqueness (§10), and error conditions (§12).
 */

import {
  BLOCK_TYPES,
  BLOCK_STATUSES,
  REACTION_STRINGS,
  type Block,
  type ValidationError,
  type ValidationResult,
} from "./types.js";

/**
 * Validate a single block in isolation.
 */
export function validateBlock(block: Block): ValidationResult {
  const errors: ValidationError[] = [];

  // --- Required fields (§4.1) ---
  if (typeof block.id !== "string" || block.id === "") {
    errors.push({ blockId: block.id ?? "(unknown)", field: "id", message: "id must be a non-empty string" });
  }
  if (typeof block.type !== "string" || block.type === "") {
    errors.push({ blockId: block.id, field: "type", message: "type must be a non-empty string" });
  }
  if (typeof block.content !== "string") {
    errors.push({ blockId: block.id, field: "content", message: "content must be a string" });
  }

  // --- ID format (§10.1): printable ASCII U+0021–U+007E ---
  if (typeof block.id === "string" && block.id !== "") {
    if (!/^[\x21-\x7e]+$/.test(block.id)) {
      errors.push({ blockId: block.id, field: "id", message: "id must contain only printable ASCII characters (U+0021–U+007E)" });
    }
  }

  // --- Type validation (§4.3) — unknown types get a warning, not a hard error ---
  const knownType = (BLOCK_TYPES as readonly string[]).includes(block.type);

  // --- Status (§4.2) ---
  if (block.status !== undefined && !(BLOCK_STATUSES as readonly string[]).includes(block.status)) {
    errors.push({ blockId: block.id, field: "status", message: `status must be "open" or "resolved", got "${block.status}"` });
  }

  // --- Suggestion constraints (§4.4) ---
  if (block.type === "suggestion") {
    if (!block.suggestion || typeof block.suggestion !== "object") {
      errors.push({ blockId: block.id, field: "suggestion", message: "suggestion type must include a suggestion object with original and replacement" });
    } else {
      if (typeof block.suggestion.original !== "string") {
        errors.push({ blockId: block.id, field: "suggestion.original", message: "suggestion.original must be a string" });
      }
      if (typeof block.suggestion.replacement !== "string") {
        errors.push({ blockId: block.id, field: "suggestion.replacement", message: "suggestion.replacement must be a string" });
      }
    }
  }

  // --- Reaction constraints (§4.6) ---
  if (block.type === "reaction") {
    if (!block.parent_id) {
      errors.push({ blockId: block.id, field: "parent_id", message: "reactions must have a parent_id" });
    }
    if (typeof block.content === "string" && block.content !== "") {
      if (!isValidReaction(block.content)) {
        errors.push({ blockId: block.id, field: "content", message: "reaction content must be a single emoji or one of: +1, -1, agree, disagree" });
      }
    }
  }

  // --- Anchor structure (§5) ---
  if (block.anchor !== undefined) {
    validateAnchor(block.id, block.anchor as unknown as Record<string, unknown>, errors);
  }

  // --- Timestamp format (ISO 8601, loose check) ---
  if (block.timestamp !== undefined && typeof block.timestamp === "string") {
    if (isNaN(Date.parse(block.timestamp))) {
      errors.push({ blockId: block.id, field: "timestamp", message: "timestamp must be a valid ISO 8601 datetime" });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a collection of blocks together (checks cross-block constraints).
 */
export function validateBlocks(blocks: Block[]): ValidationResult {
  const errors: ValidationError[] = [];

  // Individual validation
  for (const block of blocks) {
    const result = validateBlock(block);
    errors.push(...result.errors);
  }

  // --- Duplicate IDs (§10.2) ---
  const idCounts = new Map<string, number>();
  for (const block of blocks) {
    idCounts.set(block.id, (idCounts.get(block.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push({ blockId: id, field: "id", message: `duplicate id "${id}" appears ${count} times` });
    }
  }

  // --- Circular thread references (§6) ---
  const blockMap = new Map<string, Block>();
  for (const block of blocks) {
    blockMap.set(block.id, block);
  }

  const cycleBlocks = detectCycles(blocks, blockMap);
  for (const id of cycleBlocks) {
    errors.push({ blockId: id, field: "parent_id", message: `circular thread reference detected involving "${id}"` });
  }

  // --- Orphaned parent_id (§6) ---
  for (const block of blocks) {
    if (block.parent_id && !blockMap.has(block.parent_id)) {
      errors.push({ blockId: block.id, field: "parent_id", message: `parent_id "${block.parent_id}" references a non-existent block` });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateAnchor(
  blockId: string,
  anchor: Record<string, unknown>,
  errors: ValidationError[],
): void {
  if (typeof anchor.type !== "string") {
    errors.push({ blockId, field: "anchor.type", message: "anchor must have a type" });
    return;
  }

  switch (anchor.type) {
    case "text":
      if (typeof anchor.exact !== "string" || anchor.exact === "") {
        errors.push({ blockId, field: "anchor.exact", message: "text anchor must have a non-empty exact field" });
      }
      break;
    case "heading":
      if (typeof anchor.text !== "string" || anchor.text === "") {
        errors.push({ blockId, field: "anchor.text", message: "heading anchor must have a non-empty text field" });
      }
      if (anchor.level !== undefined) {
        if (typeof anchor.level !== "number" || anchor.level < 1 || anchor.level > 6) {
          errors.push({ blockId, field: "anchor.level", message: "heading anchor level must be 1–6" });
        }
      }
      break;
    case "block_index":
      if (typeof anchor.index !== "number" || anchor.index < 0 || !Number.isInteger(anchor.index)) {
        errors.push({ blockId, field: "anchor.index", message: "block_index anchor must have a non-negative integer index" });
      }
      break;
    default:
      // Unknown anchor types are not an error — forward compatibility
      break;
  }

  // Validate fallback recursively (§5.4)
  if (anchor.fallback && typeof anchor.fallback === "object") {
    validateAnchor(blockId, anchor.fallback as Record<string, unknown>, errors);
  }
}

/**
 * Detect circular parent_id references. Returns the set of block IDs involved in cycles.
 */
function detectCycles(blocks: Block[], blockMap: Map<string, Block>): Set<string> {
  const cycleIds = new Set<string>();
  const visited = new Set<string>();
  const inStack = new Set<string>();

  for (const block of blocks) {
    if (!visited.has(block.id)) {
      walkForCycles(block.id, blockMap, visited, inStack, cycleIds);
    }
  }

  return cycleIds;
}

function walkForCycles(
  id: string,
  blockMap: Map<string, Block>,
  visited: Set<string>,
  inStack: Set<string>,
  cycleIds: Set<string>,
): void {
  visited.add(id);
  inStack.add(id);

  const block = blockMap.get(id);
  if (block?.parent_id && blockMap.has(block.parent_id)) {
    if (inStack.has(block.parent_id)) {
      // Found a cycle — trace it
      let current: string | undefined = block.parent_id;
      const cyclePath: string[] = [];
      while (current && !cyclePath.includes(current)) {
        cyclePath.push(current);
        cycleIds.add(current);
        const b = blockMap.get(current);
        current = b?.parent_id ?? undefined;
      }
      cycleIds.add(id);
    } else if (!visited.has(block.parent_id)) {
      walkForCycles(block.parent_id, blockMap, visited, inStack, cycleIds);
    }
  }

  inStack.delete(id);
}

/**
 * Check if a string is a valid reaction content value (§4.6).
 * Must be a single Unicode emoji or one of the predefined strings.
 */
function isValidReaction(content: string): boolean {
  if ((REACTION_STRINGS as readonly string[]).includes(content)) {
    return true;
  }
  // Check for single emoji — a pragmatic heuristic using the emoji regex pattern.
  // This matches most common emoji including those with variation selectors and ZWJ sequences.
  const emojiRe = /^\p{Emoji_Presentation}(\u{FE0F}|\u{200D}\p{Emoji_Presentation})*$/u;
  if (emojiRe.test(content)) {
    return true;
  }
  // Also accept single-codepoint emoji with text presentation + VS16
  const singleEmoji = /^\p{Emoji}\u{FE0F}?$/u;
  return singleEmoji.test(content);
}

export { isValidReaction };
