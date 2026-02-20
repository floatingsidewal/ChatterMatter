/**
 * Yjs ↔ ChatterMatter bridge.
 *
 * ChatterMatter blocks are stored in a Yjs Y.Map keyed by block ID.
 * Each value is a plain JSON-serializable object matching the Block type.
 * The bridge converts between the Yjs shared state and the .chatter
 * sidecar / inline Markdown representation.
 */

import * as Y from "yjs";
import type { Block } from "../types.js";
import { parse } from "../parser.js";
import { serializeBlocks } from "../serializer.js";

const BLOCKS_MAP_KEY = "blocks";

// ---------------------------------------------------------------------------
// Doc initialization
// ---------------------------------------------------------------------------

/**
 * Create a Yjs Doc seeded with existing ChatterMatter blocks from a markdown
 * string (inline or sidecar content).
 */
export function createDoc(markdown: string): Y.Doc {
  const doc = new Y.Doc();
  const blocksMap = doc.getMap<Record<string, unknown>>(BLOCKS_MAP_KEY);

  const { blocks } = parse(markdown);
  doc.transact(() => {
    for (const pb of blocks) {
      blocksMap.set(pb.block.id, blockToPlain(pb.block));
    }
  });

  return doc;
}

/**
 * Create an empty Yjs Doc (for clients that will receive state via sync).
 */
export function createEmptyDoc(): Y.Doc {
  return new Y.Doc();
}

// ---------------------------------------------------------------------------
// Read from Yjs
// ---------------------------------------------------------------------------

/**
 * Get the shared blocks map from a Yjs Doc.
 */
export function getBlocksMap(doc: Y.Doc): Y.Map<Record<string, unknown>> {
  return doc.getMap<Record<string, unknown>>(BLOCKS_MAP_KEY);
}

/**
 * Read all current blocks from the Yjs Doc.
 */
export function getBlocks(doc: Y.Doc): Block[] {
  const blocksMap = getBlocksMap(doc);
  const blocks: Block[] = [];
  blocksMap.forEach((value, _key) => {
    blocks.push(plainToBlock(value));
  });
  return blocks;
}

/**
 * Get a single block by ID from the Yjs Doc.
 */
export function getBlock(doc: Y.Doc, blockId: string): Block | undefined {
  const blocksMap = getBlocksMap(doc);
  const value = blocksMap.get(blockId);
  return value ? plainToBlock(value) : undefined;
}

// ---------------------------------------------------------------------------
// Write to Yjs
// ---------------------------------------------------------------------------

/**
 * Add or update a block in the Yjs Doc.
 */
export function setBlock(doc: Y.Doc, block: Block): void {
  const blocksMap = getBlocksMap(doc);
  blocksMap.set(block.id, blockToPlain(block));
}

/**
 * Delete a block from the Yjs Doc.
 */
export function deleteBlock(doc: Y.Doc, blockId: string): boolean {
  const blocksMap = getBlocksMap(doc);
  if (!blocksMap.has(blockId)) return false;
  blocksMap.delete(blockId);
  return true;
}

// ---------------------------------------------------------------------------
// Materialization (Yjs → .chatter file content)
// ---------------------------------------------------------------------------

/**
 * Materialize the current Yjs state into ChatterMatter sidecar file content.
 * Blocks are serialized in insertion order (Yjs map iteration order).
 */
export function materialize(doc: Y.Doc): string {
  const blocks = getBlocks(doc);
  if (blocks.length === 0) return "";
  return serializeBlocks(blocks) + "\n";
}

// ---------------------------------------------------------------------------
// Observing changes
// ---------------------------------------------------------------------------

export interface BlockChange {
  action: "add" | "update" | "delete";
  blockId: string;
  block?: Block;
}

/**
 * Observe changes to the blocks map. Returns a cleanup function.
 */
export function observeBlocks(
  doc: Y.Doc,
  callback: (changes: BlockChange[], origin: unknown) => void,
): () => void {
  const blocksMap = getBlocksMap(doc);

  const handler = (event: Y.YMapEvent<Record<string, unknown>>, txn: Y.Transaction) => {
    const changes: BlockChange[] = [];

    event.changes.keys.forEach((change, key) => {
      if (change.action === "add") {
        const value = blocksMap.get(key);
        changes.push({
          action: "add",
          blockId: key,
          block: value ? plainToBlock(value) : undefined,
        });
      } else if (change.action === "update") {
        const value = blocksMap.get(key);
        changes.push({
          action: "update",
          blockId: key,
          block: value ? plainToBlock(value) : undefined,
        });
      } else if (change.action === "delete") {
        changes.push({ action: "delete", blockId: key });
      }
    });

    if (changes.length > 0) {
      callback(changes, txn.origin);
    }
  };

  blocksMap.observe(handler);
  return () => blocksMap.unobserve(handler);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Block to a plain object safe for Yjs storage.
 * Strips undefined values (Yjs doesn't handle them well).
 */
function blockToPlain(block: Block): Record<string, unknown> {
  const plain: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block)) {
    if (value !== undefined) {
      plain[key] = value;
    }
  }
  return plain;
}

/**
 * Convert a plain Yjs map value back to a Block.
 */
function plainToBlock(plain: Record<string, unknown>): Block {
  return plain as unknown as Block;
}
