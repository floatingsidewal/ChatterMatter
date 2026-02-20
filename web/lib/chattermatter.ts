/**
 * Browser-safe ChatterMatter library wrapper.
 *
 * Imports only from browser-compatible source modules (parser, serializer,
 * validator, anchor — all pure string manipulation). Reimplements the
 * high-level document operations that would otherwise pull in node:crypto.
 */

import { parse, stripBlocks } from "../../src/parser";
import { appendBlock, removeBlock, replaceBlock } from "../../src/serializer";
import { resolveAnchor } from "../../src/anchor";
import { validateBlocks } from "../../src/validator";
import type {
  Block,
  BlockType,
  BlockStatus,
  Anchor,
  ParseResult,
  AnchorResolution,
  ThreadNode,
  ValidationResult,
} from "../../src/types";

export type {
  Block,
  BlockType,
  BlockStatus,
  Anchor,
  ParseResult,
  AnchorResolution,
  ThreadNode,
  ValidationResult,
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function loadBlocks(markdown: string): ParseResult {
  return parse(markdown);
}

export function getCleanContent(markdown: string): string {
  return stripBlocks(markdown);
}

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
// Thread building
// ---------------------------------------------------------------------------

export function buildThreads(blocks: Block[]): ThreadNode[] {
  const blockMap = new Map<string, Block>();
  for (const block of blocks) {
    blockMap.set(block.id, block);
  }

  const cycleIds = detectCycles(blocks, blockMap);
  const nodeMap = new Map<string, ThreadNode>();
  for (const block of blocks) {
    nodeMap.set(block.id, { block, children: [] });
  }

  const roots: ThreadNode[] = [];
  for (const block of blocks) {
    const node = nodeMap.get(block.id)!;
    const parentId = block.parent_id;
    if (!parentId || !blockMap.has(parentId) || cycleIds.has(block.id)) {
      roots.push(node);
    } else {
      nodeMap.get(parentId)!.children.push(node);
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
        current = blockMap.get(current)?.parent_id ?? undefined;
      }
      cycleIds.add(id);
    } else if (!visited.has(block.parent_id)) {
      walk(block.parent_id, blockMap, visited, inStack, cycleIds);
    }
  }
  inStack.delete(id);
}

// ---------------------------------------------------------------------------
// Anchor resolution
// ---------------------------------------------------------------------------

export function resolveBlockAnchor(block: Block, markdown: string): AnchorResolution {
  if (!block.anchor) return { resolved: false };
  const clean = stripBlocks(markdown);
  return resolveAnchor(block.anchor, clean);
}

// ---------------------------------------------------------------------------
// Mutations (browser-safe — uses crypto.randomUUID() instead of node:crypto)
// ---------------------------------------------------------------------------

export function addComment(
  markdown: string,
  options: {
    content: string;
    type?: BlockType;
    author?: string;
    anchor?: Anchor;
    parent_id?: string;
    suggestion?: { original: string; replacement: string };
  },
): { markdown: string; block: Block } {
  const block: Block = {
    id: crypto.randomUUID(),
    type: options.type ?? "comment",
    content: options.content,
    timestamp: new Date().toISOString(),
    status: "open",
    spec_version: "0.1",
  };

  if (options.author) block.author = options.author;
  if (options.anchor) block.anchor = options.anchor;
  if (options.parent_id) block.parent_id = options.parent_id;
  if (options.suggestion) block.suggestion = options.suggestion;

  return { markdown: appendBlock(markdown, block), block };
}

export function resolveBlock(markdown: string, blockId: string): string {
  const { blocks } = parse(markdown);
  const target = blocks.find((pb) => pb.block.id === blockId);
  if (!target) throw new Error(`Block with id "${blockId}" not found`);
  const updated: Block = { ...target.block, status: "resolved" };
  return replaceBlock(markdown, updated);
}

export function deleteBlock(markdown: string, blockId: string): string {
  return removeBlock(markdown, blockId);
}
