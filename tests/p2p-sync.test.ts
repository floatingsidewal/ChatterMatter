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
  deleteBlockWithChildren,
  deleteResolvedBlocks,
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

describe("deleteBlockWithChildren", () => {
  it("deletes a block with no children", () => {
    const doc = createDoc(SAMPLE_MARKDOWN);
    const deleted = deleteBlockWithChildren(doc, "c1");
    expect(deleted).toEqual(["c1"]);
    expect(getBlocks(doc)).toHaveLength(1);
    expect(getBlock(doc, "c1")).toBeUndefined();
    doc.destroy();
  });

  it("deletes a block and all its children", () => {
    const doc = createEmptyDoc();

    // Create a thread with parent and two replies
    setBlock(doc, { id: "root", type: "comment", content: "Root comment", author: "alice", status: "open" });
    setBlock(doc, { id: "reply1", type: "comment", content: "First reply", author: "bob", status: "open", parent_id: "root" });
    setBlock(doc, { id: "reply2", type: "comment", content: "Second reply", author: "charlie", status: "open", parent_id: "root" });

    expect(getBlocks(doc)).toHaveLength(3);

    const deleted = deleteBlockWithChildren(doc, "root");
    expect(deleted).toHaveLength(3);
    expect(deleted).toContain("root");
    expect(deleted).toContain("reply1");
    expect(deleted).toContain("reply2");
    expect(getBlocks(doc)).toHaveLength(0);

    doc.destroy();
  });

  it("deletes nested children recursively", () => {
    const doc = createEmptyDoc();

    // Create a deeply nested thread
    setBlock(doc, { id: "root", type: "comment", content: "Root", author: "alice", status: "open" });
    setBlock(doc, { id: "level1", type: "comment", content: "Level 1", author: "bob", status: "open", parent_id: "root" });
    setBlock(doc, { id: "level2", type: "comment", content: "Level 2", author: "charlie", status: "open", parent_id: "level1" });
    setBlock(doc, { id: "level3", type: "comment", content: "Level 3", author: "dave", status: "open", parent_id: "level2" });

    expect(getBlocks(doc)).toHaveLength(4);

    const deleted = deleteBlockWithChildren(doc, "root");
    expect(deleted).toHaveLength(4);
    expect(getBlocks(doc)).toHaveLength(0);

    doc.destroy();
  });

  it("only deletes the subtree starting from the specified block", () => {
    const doc = createEmptyDoc();

    // Create two separate threads
    setBlock(doc, { id: "thread1", type: "comment", content: "Thread 1", author: "alice", status: "open" });
    setBlock(doc, { id: "reply1", type: "comment", content: "Reply to thread 1", author: "bob", status: "open", parent_id: "thread1" });
    setBlock(doc, { id: "thread2", type: "comment", content: "Thread 2", author: "charlie", status: "open" });
    setBlock(doc, { id: "reply2", type: "comment", content: "Reply to thread 2", author: "dave", status: "open", parent_id: "thread2" });

    expect(getBlocks(doc)).toHaveLength(4);

    const deleted = deleteBlockWithChildren(doc, "thread1");
    expect(deleted).toHaveLength(2);
    expect(deleted).toContain("thread1");
    expect(deleted).toContain("reply1");

    // Thread 2 should still exist
    expect(getBlocks(doc)).toHaveLength(2);
    expect(getBlock(doc, "thread2")).toBeDefined();
    expect(getBlock(doc, "reply2")).toBeDefined();

    doc.destroy();
  });

  it("returns empty array for non-existent block", () => {
    const doc = createDoc(SAMPLE_MARKDOWN);
    const deleted = deleteBlockWithChildren(doc, "nonexistent");
    expect(deleted).toEqual([]);
    expect(getBlocks(doc)).toHaveLength(2);
    doc.destroy();
  });

  it("can delete a child without affecting parent or siblings", () => {
    const doc = createEmptyDoc();

    setBlock(doc, { id: "parent", type: "comment", content: "Parent", author: "alice", status: "open" });
    setBlock(doc, { id: "child1", type: "comment", content: "Child 1", author: "bob", status: "open", parent_id: "parent" });
    setBlock(doc, { id: "child2", type: "comment", content: "Child 2", author: "charlie", status: "open", parent_id: "parent" });
    setBlock(doc, { id: "grandchild", type: "comment", content: "Grandchild", author: "dave", status: "open", parent_id: "child1" });

    const deleted = deleteBlockWithChildren(doc, "child1");
    expect(deleted).toHaveLength(2);
    expect(deleted).toContain("child1");
    expect(deleted).toContain("grandchild");

    // Parent and sibling should still exist
    expect(getBlocks(doc)).toHaveLength(2);
    expect(getBlock(doc, "parent")).toBeDefined();
    expect(getBlock(doc, "child2")).toBeDefined();

    doc.destroy();
  });
});

describe("deleteResolvedBlocks", () => {
  it("deletes resolved root threads and their children", () => {
    const doc = createEmptyDoc();

    // Resolved thread with replies
    setBlock(doc, { id: "resolved1", type: "comment", content: "Resolved comment", author: "alice", status: "resolved" });
    setBlock(doc, { id: "reply1", type: "comment", content: "Reply to resolved", author: "bob", status: "open", parent_id: "resolved1" });

    // Open thread
    setBlock(doc, { id: "open1", type: "comment", content: "Open comment", author: "charlie", status: "open" });

    expect(getBlocks(doc)).toHaveLength(3);

    const deleted = deleteResolvedBlocks(doc);
    expect(deleted).toHaveLength(2);
    expect(deleted).toContain("resolved1");
    expect(deleted).toContain("reply1");

    // Open thread should remain
    expect(getBlocks(doc)).toHaveLength(1);
    expect(getBlock(doc, "open1")).toBeDefined();

    doc.destroy();
  });

  it("deletes multiple resolved threads", () => {
    const doc = createEmptyDoc();

    setBlock(doc, { id: "resolved1", type: "comment", content: "Resolved 1", author: "alice", status: "resolved" });
    setBlock(doc, { id: "resolved2", type: "comment", content: "Resolved 2", author: "bob", status: "resolved" });
    setBlock(doc, { id: "open1", type: "comment", content: "Open", author: "charlie", status: "open" });

    const deleted = deleteResolvedBlocks(doc);
    expect(deleted).toHaveLength(2);
    expect(getBlocks(doc)).toHaveLength(1);
    expect(getBlock(doc, "open1")).toBeDefined();

    doc.destroy();
  });

  it("does not delete resolved replies (only root threads)", () => {
    const doc = createEmptyDoc();

    // Open thread with resolved reply
    setBlock(doc, { id: "open1", type: "comment", content: "Open thread", author: "alice", status: "open" });
    setBlock(doc, { id: "reply1", type: "comment", content: "Resolved reply", author: "bob", status: "resolved", parent_id: "open1" });

    const deleted = deleteResolvedBlocks(doc);
    expect(deleted).toHaveLength(0);
    expect(getBlocks(doc)).toHaveLength(2);

    doc.destroy();
  });

  it("returns empty array when no resolved blocks exist", () => {
    const doc = createEmptyDoc();

    setBlock(doc, { id: "open1", type: "comment", content: "Open 1", author: "alice", status: "open" });
    setBlock(doc, { id: "open2", type: "comment", content: "Open 2", author: "bob", status: "open" });

    const deleted = deleteResolvedBlocks(doc);
    expect(deleted).toHaveLength(0);
    expect(getBlocks(doc)).toHaveLength(2);

    doc.destroy();
  });

  it("returns empty array for empty doc", () => {
    const doc = createEmptyDoc();
    const deleted = deleteResolvedBlocks(doc);
    expect(deleted).toHaveLength(0);
    doc.destroy();
  });

  it("deletes deeply nested children of resolved threads", () => {
    const doc = createEmptyDoc();

    setBlock(doc, { id: "resolved", type: "comment", content: "Resolved", author: "alice", status: "resolved" });
    setBlock(doc, { id: "level1", type: "comment", content: "Level 1", author: "bob", status: "open", parent_id: "resolved" });
    setBlock(doc, { id: "level2", type: "comment", content: "Level 2", author: "charlie", status: "open", parent_id: "level1" });
    setBlock(doc, { id: "level3", type: "comment", content: "Level 3", author: "dave", status: "open", parent_id: "level2" });

    const deleted = deleteResolvedBlocks(doc);
    expect(deleted).toHaveLength(4);
    expect(getBlocks(doc)).toHaveLength(0);

    doc.destroy();
  });
});
