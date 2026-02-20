/**
 * ChatterMatter document operations — high-level API for working with
 * ChatterMatter blocks in Markdown documents.
 *
 * Combines parser, validator, anchor resolver, and serializer.
 */

import { randomUUID } from "node:crypto";
import { parse, stripBlocks } from "./parser.js";
import { validateBlock, validateBlocks } from "./validator.js";
import { resolveAnchor } from "./anchor.js";
import { appendBlock, removeBlock, replaceBlock } from "./serializer.js";
import type {
  Block,
  BlockType,
  BlockStatus,
  Anchor,
  ParseResult,
  ValidationResult,
  AnchorResolution,
  ThreadNode,
} from "./types.js";

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Load and parse all ChatterMatter blocks from a Markdown document.
 */
export function loadBlocks(markdown: string): ParseResult {
  return parse(markdown);
}

/**
 * Get the plain Markdown content with all ChatterMatter blocks removed.
 */
export function getCleanContent(markdown: string): string {
  return stripBlocks(markdown);
}

/**
 * Validate all blocks in a document.
 */
export function validate(markdown: string): ValidationResult {
  const { blocks } = parse(markdown);
  return validateBlocks(blocks.map((pb) => pb.block));
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface FilterOptions {
  type?: BlockType | BlockType[];
  status?: BlockStatus;
  author?: string;
}

/**
 * List blocks from a document, optionally filtered by type, status, or author.
 */
export function listBlocks(markdown: string, filters?: FilterOptions): Block[] {
  const { blocks } = parse(markdown);
  let result = blocks.map((pb) => pb.block);

  if (filters?.type) {
    const types = Array.isArray(filters.type) ? filters.type : [filters.type];
    result = result.filter((b) => types.includes(b.type as BlockType));
  }

  if (filters?.status) {
    result = result.filter((b) => (b.status ?? "open") === filters.status);
  }

  if (filters?.author) {
    result = result.filter((b) => b.author === filters.author);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Thread building (§6)
// ---------------------------------------------------------------------------

/**
 * Build a thread tree from a list of blocks.
 * Handles orphaned parent_ids (treated as roots) and circular references (treated as roots).
 */
export function buildThreads(blocks: Block[]): ThreadNode[] {
  const blockMap = new Map<string, Block>();
  const childrenMap = new Map<string, ThreadNode[]>();
  const roots: ThreadNode[] = [];

  for (const block of blocks) {
    blockMap.set(block.id, block);
  }

  // Detect cycles
  const cycleIds = detectCycles(blocks, blockMap);

  // Build nodes
  const nodeMap = new Map<string, ThreadNode>();
  for (const block of blocks) {
    nodeMap.set(block.id, { block, children: [] });
  }

  for (const block of blocks) {
    const node = nodeMap.get(block.id)!;
    const parentId = block.parent_id;

    if (
      !parentId ||
      !blockMap.has(parentId) ||
      cycleIds.has(block.id)
    ) {
      // Root block (no parent, orphaned parent, or in a cycle)
      roots.push(node);
    } else {
      const parentNode = nodeMap.get(parentId)!;
      parentNode.children.push(node);
    }
  }

  return roots;
}

function detectCycles(blocks: Block[], blockMap: Map<string, Block>): Set<string> {
  const cycleIds = new Set<string>();
  const visited = new Set<string>();
  const inStack = new Set<string>();

  for (const block of blocks) {
    if (!visited.has(block.id)) {
      walk(block.id, blockMap, visited, inStack, cycleIds);
    }
  }
  return cycleIds;
}

function walk(
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
      walk(block.parent_id, blockMap, visited, inStack, cycleIds);
    }
  }

  inStack.delete(id);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Add a new comment block to a Markdown document.
 * Returns the modified markdown and the new block.
 */
export function addComment(
  markdown: string,
  options: {
    content: string;
    type?: BlockType;
    author?: string;
    anchor?: Anchor;
    parent_id?: string;
  },
): { markdown: string; block: Block } {
  const block: Block = {
    id: randomUUID(),
    type: options.type ?? "comment",
    content: options.content,
    timestamp: new Date().toISOString(),
    status: "open",
    spec_version: "0.1",
  };

  if (options.author) block.author = options.author;
  if (options.anchor) block.anchor = options.anchor;
  if (options.parent_id) block.parent_id = options.parent_id;

  const newMarkdown = appendBlock(markdown, block);
  return { markdown: newMarkdown, block };
}

/**
 * Resolve a block (set status to "resolved").
 */
export function resolveBlock(markdown: string, blockId: string): string {
  const { blocks } = parse(markdown);
  const target = blocks.find((pb) => pb.block.id === blockId);

  if (!target) {
    throw new Error(`Block with id "${blockId}" not found`);
  }

  const updated: Block = { ...target.block, status: "resolved" };
  return replaceBlock(markdown, updated);
}

/**
 * Remove a block by ID from a Markdown document.
 */
export function deleteBlock(markdown: string, blockId: string): string {
  return removeBlock(markdown, blockId);
}

/**
 * Resolve an anchor for a specific block in a document.
 */
export function resolveBlockAnchor(
  block: Block,
  markdown: string,
): AnchorResolution {
  if (!block.anchor) {
    return { resolved: false };
  }
  const clean = stripBlocks(markdown);
  return resolveAnchor(block.anchor, clean);
}
