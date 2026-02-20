import { describe, it, expect } from "vitest";
import {
  loadBlocks,
  getCleanContent,
  validate,
  listBlocks,
  buildThreads,
  addComment,
  resolveBlock,
  deleteBlock,
} from "../src/document.js";

const SAMPLE = `# Test Doc

First paragraph with some text.

\`\`\`chattermatter
{
  "id": "c1",
  "type": "comment",
  "author": "alice",
  "content": "Good opening.",
  "anchor": { "type": "text", "exact": "some text" },
  "status": "open"
}
\`\`\`

\`\`\`chattermatter
{
  "id": "c2",
  "type": "question",
  "author": "bob",
  "content": "Can you clarify?",
  "parent_id": "c1",
  "status": "open"
}
\`\`\`

\`\`\`chattermatter
{
  "id": "c3",
  "type": "suggestion",
  "author": "carol",
  "content": "Consider rewording.",
  "suggestion": { "original": "some text", "replacement": "detailed content" },
  "anchor": { "type": "text", "exact": "some text" },
  "status": "open"
}
\`\`\`

Second paragraph.
`;

describe("loadBlocks", () => {
  it("loads all blocks from a document", () => {
    const result = loadBlocks(SAMPLE);
    expect(result.blocks).toHaveLength(3);
  });
});

describe("getCleanContent", () => {
  it("returns document without chattermatter blocks", () => {
    const clean = getCleanContent(SAMPLE);
    expect(clean).toContain("# Test Doc");
    expect(clean).toContain("First paragraph");
    expect(clean).toContain("Second paragraph");
    expect(clean).not.toContain("chattermatter");
  });
});

describe("validate", () => {
  it("validates a correct document", () => {
    const result = validate(SAMPLE);
    expect(result.valid).toBe(true);
  });
});

describe("listBlocks", () => {
  it("lists all blocks", () => {
    const blocks = listBlocks(SAMPLE);
    expect(blocks).toHaveLength(3);
  });

  it("filters by type", () => {
    const blocks = listBlocks(SAMPLE, { type: "question" });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("question");
  });

  it("filters by author", () => {
    const blocks = listBlocks(SAMPLE, { author: "carol" });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("c3");
  });

  it("filters by status", () => {
    const blocks = listBlocks(SAMPLE, { status: "open" });
    expect(blocks).toHaveLength(3);
  });
});

describe("buildThreads", () => {
  it("builds thread tree", () => {
    const blocks = listBlocks(SAMPLE);
    const trees = buildThreads(blocks);
    // c1 is root with c2 as child; c3 is separate root
    expect(trees).toHaveLength(2);
    const c1Thread = trees.find((t) => t.block.id === "c1");
    expect(c1Thread).toBeDefined();
    expect(c1Thread!.children).toHaveLength(1);
    expect(c1Thread!.children[0].block.id).toBe("c2");
  });

  it("handles circular references by treating them as roots", () => {
    const blocks = [
      { id: "a", type: "comment", content: "A", parent_id: "b" },
      { id: "b", type: "comment", content: "B", parent_id: "a" },
    ] as any[];
    const trees = buildThreads(blocks);
    expect(trees).toHaveLength(2); // Both treated as roots
  });
});

describe("addComment", () => {
  it("adds a comment to a document", () => {
    const { markdown, block } = addComment("# Doc\n\nText.\n", {
      content: "New comment",
      author: "dave",
    });
    expect(markdown).toContain("New comment");
    expect(markdown).toContain("chattermatter");
    expect(block.id).toBeDefined();
    expect(block.type).toBe("comment");
    expect(block.author).toBe("dave");
  });

  it("adds an anchored comment", () => {
    const { block } = addComment("# Doc\n\nSome text here.\n", {
      content: "Anchored",
      anchor: { type: "text", exact: "Some text" },
    });
    expect(block.anchor).toEqual({ type: "text", exact: "Some text" });
  });
});

describe("resolveBlock", () => {
  it("sets status to resolved", () => {
    const updated = resolveBlock(SAMPLE, "c1");
    const blocks = listBlocks(updated, { status: "resolved" });
    expect(blocks.some((b) => b.id === "c1")).toBe(true);
  });

  it("throws for non-existent block", () => {
    expect(() => resolveBlock(SAMPLE, "nonexistent")).toThrow("not found");
  });
});

describe("deleteBlock", () => {
  it("removes a block from the document", () => {
    const updated = deleteBlock(SAMPLE, "c2");
    const blocks = listBlocks(updated);
    expect(blocks.some((b) => b.id === "c2")).toBe(false);
    expect(blocks).toHaveLength(2);
  });
});
