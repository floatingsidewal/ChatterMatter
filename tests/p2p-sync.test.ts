/**
 * Tests for the Yjs ↔ ChatterMatter bridge (sync.ts).
 */

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createDoc,
  createEmptyDoc,
  getBlocks,
  getBlock,
  setBlock,
  deleteBlock,
  materialize,
  observeBlocks,
  getBlocksMap,
} from "../src/p2p/sync.js";
import type { Block } from "../src/types.js";

const SAMPLE_MARKDOWN = `# Test Document

Some content here.

\`\`\`chattermatter
{
  "id": "c1",
  "type": "comment",
  "content": "This is a test comment",
  "author": "alice",
  "status": "open"
}
\`\`\`

\`\`\`chattermatter
{
  "id": "c2",
  "type": "question",
  "content": "Is this correct?",
  "author": "bob",
  "status": "open"
}
\`\`\`
`;

describe("createDoc", () => {
  it("loads existing blocks from markdown into Yjs", () => {
    const doc = createDoc(SAMPLE_MARKDOWN);
    const blocks = getBlocks(doc);
    expect(blocks).toHaveLength(2);
    expect(blocks.find((b) => b.id === "c1")).toBeDefined();
    expect(blocks.find((b) => b.id === "c2")).toBeDefined();
    doc.destroy();
  });

  it("handles empty markdown", () => {
    const doc = createDoc("");
    expect(getBlocks(doc)).toHaveLength(0);
    doc.destroy();
  });

  it("handles markdown with no blocks", () => {
    const doc = createDoc("# Just a heading\n\nSome text.");
    expect(getBlocks(doc)).toHaveLength(0);
    doc.destroy();
  });
});

describe("createEmptyDoc", () => {
  it("creates a doc with no blocks", () => {
    const doc = createEmptyDoc();
    expect(getBlocks(doc)).toHaveLength(0);
    doc.destroy();
  });
});

describe("getBlock", () => {
  it("returns a specific block by ID", () => {
    const doc = createDoc(SAMPLE_MARKDOWN);
    const block = getBlock(doc, "c1");
    expect(block).toBeDefined();
    expect(block!.content).toBe("This is a test comment");
    doc.destroy();
  });

  it("returns undefined for non-existent ID", () => {
    const doc = createDoc(SAMPLE_MARKDOWN);
    expect(getBlock(doc, "nonexistent")).toBeUndefined();
    doc.destroy();
  });
});

describe("setBlock", () => {
  it("adds a new block to the doc", () => {
    const doc = createDoc("");
    const block: Block = {
      id: "new1",
      type: "comment",
      content: "New comment",
      author: "charlie",
      status: "open",
    };
    setBlock(doc, block);
    expect(getBlocks(doc)).toHaveLength(1);
    expect(getBlock(doc, "new1")!.content).toBe("New comment");
    doc.destroy();
  });

  it("updates an existing block", () => {
    const doc = createDoc(SAMPLE_MARKDOWN);
    const updated: Block = {
      id: "c1",
      type: "comment",
      content: "Updated content",
      author: "alice",
      status: "resolved",
    };
    setBlock(doc, updated);
    const block = getBlock(doc, "c1");
    expect(block!.content).toBe("Updated content");
    expect(block!.status).toBe("resolved");
    doc.destroy();
  });
});

describe("deleteBlock", () => {
  it("removes a block by ID", () => {
    const doc = createDoc(SAMPLE_MARKDOWN);
    expect(deleteBlock(doc, "c1")).toBe(true);
    expect(getBlocks(doc)).toHaveLength(1);
    expect(getBlock(doc, "c1")).toBeUndefined();
    doc.destroy();
  });

  it("returns false for non-existent ID", () => {
    const doc = createDoc(SAMPLE_MARKDOWN);
    expect(deleteBlock(doc, "nonexistent")).toBe(false);
    expect(getBlocks(doc)).toHaveLength(2);
    doc.destroy();
  });
});

describe("materialize", () => {
  it("serializes blocks to chattermatter format", () => {
    const doc = createDoc(SAMPLE_MARKDOWN);
    const content = materialize(doc);
    expect(content).toContain("```chattermatter");
    expect(content).toContain('"c1"');
    expect(content).toContain('"c2"');
    doc.destroy();
  });

  it("returns empty string for empty doc", () => {
    const doc = createEmptyDoc();
    expect(materialize(doc)).toBe("");
    doc.destroy();
  });
});

describe("observeBlocks", () => {
  it("fires on block addition", () => {
    const doc = createDoc("");
    const changes: Array<{ action: string; blockId: string }> = [];

    observeBlocks(doc, (c) => {
      changes.push(...c.map((ch) => ({ action: ch.action, blockId: ch.blockId })));
    });

    setBlock(doc, { id: "obs1", type: "comment", content: "Observed", status: "open" });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ action: "add", blockId: "obs1" });
    doc.destroy();
  });

  it("fires on block update", () => {
    const doc = createDoc(SAMPLE_MARKDOWN);
    const changes: Array<{ action: string; blockId: string }> = [];

    observeBlocks(doc, (c) => {
      changes.push(...c.map((ch) => ({ action: ch.action, blockId: ch.blockId })));
    });

    setBlock(doc, { id: "c1", type: "comment", content: "Changed", status: "open" });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ action: "update", blockId: "c1" });
    doc.destroy();
  });

  it("fires on block deletion", () => {
    const doc = createDoc(SAMPLE_MARKDOWN);
    const changes: Array<{ action: string; blockId: string }> = [];

    observeBlocks(doc, (c) => {
      changes.push(...c.map((ch) => ({ action: ch.action, blockId: ch.blockId })));
    });

    deleteBlock(doc, "c1");

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ action: "delete", blockId: "c1" });
    doc.destroy();
  });

  it("cleanup function stops observation", () => {
    const doc = createDoc("");
    let callCount = 0;

    const cleanup = observeBlocks(doc, () => { callCount++; });

    setBlock(doc, { id: "a", type: "comment", content: "x", status: "open" });
    expect(callCount).toBe(1);

    cleanup();

    setBlock(doc, { id: "b", type: "comment", content: "y", status: "open" });
    expect(callCount).toBe(1); // no additional call
    doc.destroy();
  });
});

describe("Yjs sync between docs", () => {
  it("syncs state from one doc to another via update", () => {
    const doc1 = createDoc(SAMPLE_MARKDOWN);
    const doc2 = createEmptyDoc();

    // Transfer full state
    const update = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, update);

    expect(getBlocks(doc2)).toHaveLength(2);
    expect(getBlock(doc2, "c1")!.content).toBe("This is a test comment");

    doc1.destroy();
    doc2.destroy();
  });

  it("syncs incremental updates", () => {
    const doc1 = createDoc(SAMPLE_MARKDOWN);
    const doc2 = createEmptyDoc();

    // Initial sync
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    // Add a block to doc1
    setBlock(doc1, {
      id: "c3",
      type: "suggestion",
      content: "Try this instead",
      status: "open",
      suggestion: { original: "old", replacement: "new" },
    });

    // Sync the incremental update
    const sv = Y.encodeStateVector(doc2);
    const diff = Y.encodeStateAsUpdate(doc1, sv);
    Y.applyUpdate(doc2, diff);

    expect(getBlocks(doc2)).toHaveLength(3);
    expect(getBlock(doc2, "c3")!.content).toBe("Try this instead");

    doc1.destroy();
    doc2.destroy();
  });

  it("handles concurrent additions without conflict", () => {
    const doc1 = createDoc("");
    const doc2 = createDoc("");

    // Both add blocks concurrently
    setBlock(doc1, { id: "a1", type: "comment", content: "From doc1", status: "open" });
    setBlock(doc2, { id: "a2", type: "comment", content: "From doc2", status: "open" });

    // Cross-sync
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

    // Both docs should have both blocks
    expect(getBlocks(doc1)).toHaveLength(2);
    expect(getBlocks(doc2)).toHaveLength(2);

    doc1.destroy();
    doc2.destroy();
  });
});
