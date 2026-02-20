/**
 * Master validation layer.
 *
 * The master validates every incoming CRDT update before applying it.
 * This prevents invalid blocks from propagating to other peers.
 */

import * as Y from "yjs";
import { validateBlock } from "../validator.js";
import type { Block } from "../types.js";
import { getBlocksMap } from "./sync.js";
import type { ValidationResult, PeerRole } from "./types.js";

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

interface RateLimitState {
  count: number;
  windowStart: number;
}

const DEFAULT_RATE_LIMIT = 60; // blocks per minute per peer
const RATE_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export class MasterValidator {
  private rateLimits = new Map<string, RateLimitState>();
  private rateLimit: number;

  constructor(options?: { rateLimit?: number }) {
    this.rateLimit = options?.rateLimit ?? DEFAULT_RATE_LIMIT;
  }

  /**
   * Check if a role has write permissions.
   * Viewers cannot write; masters and reviewers can.
   */
  canWrite(role: PeerRole): boolean {
    return role !== "viewer";
  }

  /**
   * Validate a proposed block addition against the current doc state.
   */
  validateAdd(doc: Y.Doc, block: Block, peerId: string, role: PeerRole = "reviewer"): ValidationResult {
    // Role check
    if (!this.canWrite(role)) {
      return { valid: false, reason: "Viewers cannot add blocks" };
    }

    // Rate limiting
    const rateLimitResult = this.checkRateLimit(peerId);
    if (!rateLimitResult.valid) return rateLimitResult;

    // Duplicate ID check
    const blocksMap = getBlocksMap(doc);
    if (blocksMap.has(block.id)) {
      return { valid: false, reason: `Duplicate block ID: ${block.id}` };
    }

    // Schema validation (uses existing spec validator)
    const specResult = validateBlock(block);
    if (!specResult.valid) {
      const messages = specResult.errors.map((e) => `${e.field}: ${e.message}`);
      return { valid: false, reason: messages.join("; ") };
    }

    // Parent reference check
    if (block.parent_id && !blocksMap.has(block.parent_id)) {
      return {
        valid: false,
        reason: `Parent block not found: ${block.parent_id}`,
      };
    }

    return { valid: true };
  }

  /**
   * Validate a proposed block update (e.g. status change).
   */
  validateUpdate(doc: Y.Doc, block: Block, peerId: string, role: PeerRole = "reviewer"): ValidationResult {
    // Role check
    if (!this.canWrite(role)) {
      return { valid: false, reason: "Viewers cannot update blocks" };
    }

    const rateLimitResult = this.checkRateLimit(peerId);
    if (!rateLimitResult.valid) return rateLimitResult;

    const blocksMap = getBlocksMap(doc);
    if (!blocksMap.has(block.id)) {
      return { valid: false, reason: `Block not found: ${block.id}` };
    }

    const specResult = validateBlock(block);
    if (!specResult.valid) {
      const messages = specResult.errors.map((e) => `${e.field}: ${e.message}`);
      return { valid: false, reason: messages.join("; ") };
    }

    return { valid: true };
  }

  /**
   * Validate a proposed block deletion.
   */
  validateDelete(doc: Y.Doc, blockId: string, peerId: string, role: PeerRole = "reviewer"): ValidationResult {
    // Role check
    if (!this.canWrite(role)) {
      return { valid: false, reason: "Viewers cannot delete blocks" };
    }

    const rateLimitResult = this.checkRateLimit(peerId);
    if (!rateLimitResult.valid) return rateLimitResult;

    const blocksMap = getBlocksMap(doc);
    if (!blocksMap.has(blockId)) {
      return { valid: false, reason: `Block not found: ${blockId}` };
    }

    return { valid: true };
  }

  /**
   * Validate changes extracted from a Yjs update by diffing before/after state.
   * Returns validation results for each changed block.
   */
  validateUpdate_fromDiff(
    doc: Y.Doc,
    beforeIds: Set<string>,
    afterMap: Y.Map<Record<string, unknown>>,
    peerId: string,
    role: PeerRole = "reviewer",
  ): { valid: boolean; rejections: Array<{ blockId: string; reason: string }> } {
    // Early role check for any changes
    if (!this.canWrite(role)) {
      const afterIds = new Set<string>();
      afterMap.forEach((_v, k) => afterIds.add(k));

      // Check if there are any actual changes
      const hasNewBlocks = [...afterIds].some(id => !beforeIds.has(id));
      const hasRemovedBlocks = [...beforeIds].some(id => !afterIds.has(id));

      if (hasNewBlocks || hasRemovedBlocks) {
        const rejections: Array<{ blockId: string; reason: string }> = [];
        for (const id of afterIds) {
          if (!beforeIds.has(id)) {
            rejections.push({ blockId: id, reason: "Viewers cannot add blocks" });
          }
        }
        for (const id of beforeIds) {
          if (!afterIds.has(id)) {
            rejections.push({ blockId: id, reason: "Viewers cannot delete blocks" });
          }
        }
        return { valid: false, rejections };
      }
    }

    const rejections: Array<{ blockId: string; reason: string }> = [];
    const afterIds = new Set<string>();
    afterMap.forEach((_v, k) => afterIds.add(k));

    // Check new blocks
    for (const id of afterIds) {
      if (!beforeIds.has(id)) {
        const plain = afterMap.get(id);
        if (plain) {
          const block = plain as unknown as Block;
          const result = this.validateAdd(doc, block, peerId, role);
          if (!result.valid) {
            rejections.push({ blockId: id, reason: result.reason! });
          }
        }
      }
    }

    // Check modified blocks
    for (const id of afterIds) {
      if (beforeIds.has(id)) {
        const plain = afterMap.get(id);
        if (plain) {
          const block = plain as unknown as Block;
          const result = this.validateUpdate(doc, block, peerId, role);
          if (!result.valid) {
            rejections.push({ blockId: id, reason: result.reason! });
          }
        }
      }
    }

    return {
      valid: rejections.length === 0,
      rejections,
    };
  }

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  private checkRateLimit(peerId: string): ValidationResult {
    const now = Date.now();
    let state = this.rateLimits.get(peerId);

    if (!state || now - state.windowStart > RATE_WINDOW_MS) {
      state = { count: 0, windowStart: now };
      this.rateLimits.set(peerId, state);
    }

    state.count++;

    if (state.count > this.rateLimit) {
      return {
        valid: false,
        reason: `Rate limit exceeded: max ${this.rateLimit} operations per minute`,
      };
    }

    return { valid: true };
  }

  /**
   * Reset rate limit state for a peer (e.g. on disconnect).
   */
  resetRateLimit(peerId: string): void {
    this.rateLimits.delete(peerId);
  }
}
