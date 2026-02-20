/**
 * Tests for the master validation layer.
 */

import { describe, it, expect } from "vitest";
import { MasterValidator } from "../src/p2p/validation.js";
import { createDoc, setBlock } from "../src/p2p/sync.js";
import type { Block } from "../src/types.js";
import type { PeerRole } from "../src/p2p/types.js";

const SAMPLE_MARKDOWN = `\`\`\`chattermatter
{
  "id": "existing1",
  "type": "comment",
  "content": "Existing comment",
  "status": "open"
}
\`\`\`
`;

describe("MasterValidator", () => {
  describe("validateAdd", () => {
    it("accepts a valid new block", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "new1",
        type: "comment",
        content: "New comment",
        status: "open",
      };

      const result = validator.validateAdd(doc, block, "peer1");
      expect(result.valid).toBe(true);
      doc.destroy();
    });

    it("rejects duplicate ID", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "existing1", // already in doc
        type: "comment",
        content: "Duplicate",
        status: "open",
      };

      const result = validator.validateAdd(doc, block, "peer1");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Duplicate");
      doc.destroy();
    });

    it("rejects block with missing required fields", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block = {
        id: "new2",
        type: "comment",
        // missing content
      } as unknown as Block;

      const result = validator.validateAdd(doc, block, "peer1");
      expect(result.valid).toBe(false);
      doc.destroy();
    });

    it("rejects block referencing non-existent parent", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "reply1",
        type: "comment",
        content: "Reply to nowhere",
        parent_id: "nonexistent",
        status: "open",
      };

      const result = validator.validateAdd(doc, block, "peer1");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Parent block not found");
      doc.destroy();
    });

    it("accepts block referencing valid parent", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "reply1",
        type: "comment",
        content: "Valid reply",
        parent_id: "existing1",
        status: "open",
      };

      const result = validator.validateAdd(doc, block, "peer1");
      expect(result.valid).toBe(true);
      doc.destroy();
    });
  });

  describe("validateUpdate", () => {
    it("accepts update to existing block", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "existing1",
        type: "comment",
        content: "Updated content",
        status: "resolved",
      };

      const result = validator.validateUpdate(doc, block, "peer1");
      expect(result.valid).toBe(true);
      doc.destroy();
    });

    it("rejects update to non-existent block", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "nonexistent",
        type: "comment",
        content: "Ghost block",
        status: "open",
      };

      const result = validator.validateUpdate(doc, block, "peer1");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not found");
      doc.destroy();
    });
  });

  describe("validateDelete", () => {
    it("accepts deletion of existing block", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const result = validator.validateDelete(doc, "existing1", "peer1");
      expect(result.valid).toBe(true);
      doc.destroy();
    });

    it("rejects deletion of non-existent block", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const result = validator.validateDelete(doc, "nonexistent", "peer1");
      expect(result.valid).toBe(false);
      doc.destroy();
    });
  });

  describe("rate limiting", () => {
    it("enforces rate limit", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator({ rateLimit: 3 });

      // First 3 should succeed
      for (let i = 0; i < 3; i++) {
        const block: Block = {
          id: `rate${i}`,
          type: "comment",
          content: `Comment ${i}`,
          status: "open",
        };
        const result = validator.validateAdd(doc, block, "spammer");
        expect(result.valid).toBe(true);
      }

      // 4th should be rate limited
      const block: Block = {
        id: "rate3",
        type: "comment",
        content: "One too many",
        status: "open",
      };
      const result = validator.validateAdd(doc, block, "spammer");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Rate limit");

      doc.destroy();
    });

    it("rate limit is per-peer", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator({ rateLimit: 1 });

      const block1: Block = { id: "a1", type: "comment", content: "x", status: "open" };
      const block2: Block = { id: "a2", type: "comment", content: "y", status: "open" };

      expect(validator.validateAdd(doc, block1, "peer1").valid).toBe(true);
      expect(validator.validateAdd(doc, block2, "peer2").valid).toBe(true);

      doc.destroy();
    });

    it("resetRateLimit clears limit for a peer", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator({ rateLimit: 1 });

      const block1: Block = { id: "r1", type: "comment", content: "x", status: "open" };
      expect(validator.validateAdd(doc, block1, "peer1").valid).toBe(true);

      const block2: Block = { id: "r2", type: "comment", content: "y", status: "open" };
      expect(validator.validateAdd(doc, block2, "peer1").valid).toBe(false);

      validator.resetRateLimit("peer1");

      const block3: Block = { id: "r3", type: "comment", content: "z", status: "open" };
      expect(validator.validateAdd(doc, block3, "peer1").valid).toBe(true);

      doc.destroy();
    });
  });

  describe("role enforcement", () => {
    it("canWrite returns true for master and reviewer", () => {
      const validator = new MasterValidator();
      expect(validator.canWrite("master")).toBe(true);
      expect(validator.canWrite("reviewer")).toBe(true);
    });

    it("canWrite returns false for viewer", () => {
      const validator = new MasterValidator();
      expect(validator.canWrite("viewer")).toBe(false);
    });

    it("validateAdd rejects viewers", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "viewer-block",
        type: "comment",
        content: "Viewer attempt",
        status: "open",
      };

      const result = validator.validateAdd(doc, block, "viewer-peer", "viewer");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Viewers cannot add");
      doc.destroy();
    });

    it("validateUpdate rejects viewers", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "existing1",
        type: "comment",
        content: "Viewer update",
        status: "resolved",
      };

      const result = validator.validateUpdate(doc, block, "viewer-peer", "viewer");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Viewers cannot update");
      doc.destroy();
    });

    it("validateDelete rejects viewers", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const result = validator.validateDelete(doc, "existing1", "viewer-peer", "viewer");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Viewers cannot delete");
      doc.destroy();
    });

    it("defaults to reviewer role when not specified", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "default-role-block",
        type: "comment",
        content: "Should work",
        status: "open",
      };

      // Call without role parameter - should default to reviewer
      const result = validator.validateAdd(doc, block, "peer1");
      expect(result.valid).toBe(true);
      doc.destroy();
    });
  });
});
