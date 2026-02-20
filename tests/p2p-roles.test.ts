/**
 * Tests for P2P role enforcement.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MasterValidator } from "../src/p2p/validation.js";
import { MasterSession } from "../src/p2p/master.js";
import { createDoc, setBlock } from "../src/p2p/sync.js";
import type { Block } from "../src/types.js";
import type { PeerRole } from "../src/p2p/types.js";
import { ulid } from "ulid";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAMPLE_MARKDOWN = `\`\`\`chattermatter
{
  "id": "existing1",
  "type": "comment",
  "content": "Existing comment",
  "status": "open"
}
\`\`\`
`;

describe("Role enforcement", () => {
  describe("canWrite", () => {
    it("returns true for master role", () => {
      const validator = new MasterValidator();
      expect(validator.canWrite("master")).toBe(true);
    });

    it("returns true for reviewer role", () => {
      const validator = new MasterValidator();
      expect(validator.canWrite("reviewer")).toBe(true);
    });

    it("returns false for viewer role", () => {
      const validator = new MasterValidator();
      expect(validator.canWrite("viewer")).toBe(false);
    });
  });

  describe("validateAdd with roles", () => {
    it("allows reviewer to add blocks", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "new1",
        type: "comment",
        content: "New comment",
        status: "open",
      };

      const result = validator.validateAdd(doc, block, "peer1", "reviewer");
      expect(result.valid).toBe(true);
      doc.destroy();
    });

    it("allows master to add blocks", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "new1",
        type: "comment",
        content: "New comment",
        status: "open",
      };

      const result = validator.validateAdd(doc, block, "peer1", "master");
      expect(result.valid).toBe(true);
      doc.destroy();
    });

    it("rejects viewer adding blocks", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "new1",
        type: "comment",
        content: "New comment",
        status: "open",
      };

      const result = validator.validateAdd(doc, block, "peer1", "viewer");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Viewers cannot add");
      doc.destroy();
    });
  });

  describe("validateUpdate with roles", () => {
    it("allows reviewer to update blocks", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "existing1",
        type: "comment",
        content: "Updated content",
        status: "resolved",
      };

      const result = validator.validateUpdate(doc, block, "peer1", "reviewer");
      expect(result.valid).toBe(true);
      doc.destroy();
    });

    it("rejects viewer updating blocks", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const block: Block = {
        id: "existing1",
        type: "comment",
        content: "Updated content",
        status: "resolved",
      };

      const result = validator.validateUpdate(doc, block, "peer1", "viewer");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Viewers cannot update");
      doc.destroy();
    });
  });

  describe("validateDelete with roles", () => {
    it("allows reviewer to delete blocks", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const result = validator.validateDelete(doc, "existing1", "peer1", "reviewer");
      expect(result.valid).toBe(true);
      doc.destroy();
    });

    it("rejects viewer deleting blocks", () => {
      const doc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      const result = validator.validateDelete(doc, "existing1", "peer1", "viewer");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Viewers cannot delete");
      doc.destroy();
    });
  });

  describe("validateUpdate_fromDiff with roles", () => {
    it("allows reviewer changes", () => {
      // Create a base doc
      const baseDoc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      // Capture before state
      const beforeIds = new Set<string>();
      const beforeMap = baseDoc.getMap<Record<string, unknown>>("blocks");
      beforeMap.forEach((_v, k) => beforeIds.add(k));

      // Create a temp doc with the new block (simulating incoming update)
      const tempDoc = createDoc(SAMPLE_MARKDOWN);
      const tempBlocksMap = tempDoc.getMap<Record<string, unknown>>("blocks");
      tempBlocksMap.set("new1", {
        id: "new1",
        type: "comment",
        content: "New block",
        status: "open",
      });

      const result = validator.validateUpdate_fromDiff(
        baseDoc,
        beforeIds,
        tempBlocksMap,
        "peer1",
        "reviewer",
      );
      expect(result.valid).toBe(true);

      baseDoc.destroy();
      tempDoc.destroy();
    });

    it("rejects viewer changes", () => {
      // Create a base doc
      const baseDoc = createDoc(SAMPLE_MARKDOWN);
      const validator = new MasterValidator();

      // Capture before state
      const beforeIds = new Set<string>();
      const beforeMap = baseDoc.getMap<Record<string, unknown>>("blocks");
      beforeMap.forEach((_v, k) => beforeIds.add(k));

      // Create a temp doc with the new block (simulating incoming update)
      const tempDoc = createDoc(SAMPLE_MARKDOWN);
      const tempBlocksMap = tempDoc.getMap<Record<string, unknown>>("blocks");
      tempBlocksMap.set("new1", {
        id: "new1",
        type: "comment",
        content: "New block",
        status: "open",
      });

      const result = validator.validateUpdate_fromDiff(
        baseDoc,
        beforeIds,
        tempBlocksMap,
        "peer1",
        "viewer",
      );
      expect(result.valid).toBe(false);
      expect(result.rejections.length).toBeGreaterThan(0);
      expect(result.rejections[0].reason).toContain("Viewers cannot");

      baseDoc.destroy();
      tempDoc.destroy();
    });
  });
});

describe("MasterSession role management", () => {
  let tempDir: string;
  let master: MasterSession;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "chattermatter-test-"));
    const docPath = join(tempDir, "test.md");
    writeFileSync(docPath, "# Test\n", "utf-8");

    master = new MasterSession({
      sessionId: ulid(),
      masterName: "alice",
      documentPath: docPath,
      port: 0, // Will not actually start server in these tests
      sidecar: true,
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe("findPeerByName", () => {
    it("returns undefined when no peers", () => {
      const peer = master.findPeerByName("bob");
      expect(peer).toBeUndefined();
    });
  });

  describe("changePeerRole", () => {
    it("returns false when peer not found", () => {
      const result = master.changePeerRole("nonexistent", "reviewer");
      expect(result).toBe(false);
    });
  });
});
