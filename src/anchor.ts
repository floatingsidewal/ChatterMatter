/**
 * ChatterMatter anchor resolver — resolves anchors to document locations.
 *
 * Implements the resolution rules from §5 of the spec.
 */

import type { Anchor, AnchorResolution, ResolvedAnchor } from "./types.js";

/**
 * Resolve an anchor against a Markdown document's plain text content.
 *
 * @param anchor - The anchor to resolve
 * @param markdown - The full Markdown document content (with ChatterMatter blocks stripped)
 */
export function resolveAnchor(anchor: Anchor, markdown: string): AnchorResolution {
  const primary = resolveAnchorSingle(anchor, markdown);
  if (primary.resolved) {
    return primary;
  }

  // Try fallback (§5.4)
  if (anchor.fallback) {
    const fallback = resolveAnchorSingle(anchor.fallback, markdown);
    if (fallback.resolved) {
      return {
        resolved: true,
        result: { ...fallback.result, usedFallback: true },
      };
    }
  }

  return { resolved: false };
}

function resolveAnchorSingle(anchor: Anchor, markdown: string): AnchorResolution {
  switch (anchor.type) {
    case "text":
      return resolveTextAnchor(anchor.exact, anchor.context_before, anchor.context_after, markdown);
    case "heading":
      return resolveHeadingAnchor(anchor.text, anchor.level, markdown);
    case "block_index":
      return resolveBlockIndexAnchor(anchor.index, markdown);
    default:
      return { resolved: false };
  }
}

/**
 * Resolve a text quote anchor (§5.1).
 *
 * Resolution rules:
 * 1. Find all occurrences of `exact` in the document.
 * 2. Filter by context_before/context_after if provided.
 * 3. If one match remains, use it.
 * 4. If multiple, use the first.
 * 5. If zero, unresolved.
 */
function resolveTextAnchor(
  exact: string,
  contextBefore: string | undefined,
  contextAfter: string | undefined,
  markdown: string,
): AnchorResolution {
  const matches: number[] = [];
  let searchStart = 0;

  while (true) {
    const idx = markdown.indexOf(exact, searchStart);
    if (idx === -1) break;
    matches.push(idx);
    searchStart = idx + 1;
  }

  if (matches.length === 0) {
    return { resolved: false };
  }

  // Filter by context
  let filtered = matches;

  if (contextBefore) {
    filtered = filtered.filter((offset) => {
      const precedingText = markdown.slice(Math.max(0, offset - contextBefore.length), offset);
      return precedingText.endsWith(contextBefore);
    });
  }

  if (contextAfter) {
    filtered = filtered.filter((offset) => {
      const followingStart = offset + exact.length;
      const followingText = markdown.slice(followingStart, followingStart + contextAfter.length);
      return followingText.startsWith(contextAfter);
    });
  }

  // Fall back to unfiltered matches if context filtering eliminated everything
  const finalMatches = filtered.length > 0 ? filtered : matches;

  if (finalMatches.length === 0) {
    return { resolved: false };
  }

  // Use the first match (§5.1 rule 4)
  return {
    resolved: true,
    result: {
      offset: finalMatches[0],
      length: exact.length,
      usedFallback: false,
    },
  };
}

/**
 * Resolve a heading anchor (§5.2).
 */
function resolveHeadingAnchor(
  text: string,
  level: number | undefined,
  markdown: string,
): AnchorResolution {
  // Match Markdown headings: lines starting with # (ATX style)
  const headingRe = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#*)?$/gm;
  const matches: Array<{ offset: number; length: number }> = [];

  for (const match of markdown.matchAll(headingRe)) {
    const headingLevel = match[1].length;
    const headingText = match[2].trim();

    if (headingText === text) {
      if (level === undefined || headingLevel === level) {
        matches.push({
          offset: match.index!,
          length: match[0].length,
        });
      }
    }
  }

  if (matches.length === 0) {
    return { resolved: false };
  }

  return {
    resolved: true,
    result: {
      offset: matches[0].offset,
      length: matches[0].length,
      usedFallback: false,
    },
  };
}

/**
 * Resolve a block index anchor (§5.3).
 *
 * "Top-level blocks" are separated by blank lines. This is a simplified model
 * that counts paragraphs, headings, lists, code blocks, etc. as blocks.
 */
function resolveBlockIndexAnchor(index: number, markdown: string): AnchorResolution {
  // Split by blank lines to find top-level blocks
  const blockRe = /(?:^|\n\n)([^\n][\s\S]*?)(?=\n\n|$)/g;
  const blocks: Array<{ offset: number; length: number }> = [];

  for (const match of markdown.matchAll(blockRe)) {
    const content = match[1];
    // Adjust offset: if preceded by \n\n, the actual content starts after it
    const offset = match.index! + (match[0].startsWith("\n\n") ? 2 : 0);
    blocks.push({ offset, length: content.length });
  }

  if (index < 0 || index >= blocks.length) {
    return { resolved: false };
  }

  return {
    resolved: true,
    result: {
      offset: blocks[index].offset,
      length: blocks[index].length,
      usedFallback: false,
    },
  };
}
