import { describe, it, expect } from "vitest";
import {
  serializeBlock,
  serializeBlocks,
  appendBlock,
  removeBlock,
  replaceBlock,
} from "../src/serializer.js";
import type { Block } from "../src/types.js";

const BLOCK: Block = {
  id: "test-1",
  type: "comment",
  content: "Test comment",
  author: "alice",
  status: "open",
};

describe("serializeBlock", () => {
  it("produces a valid fenced code block", () => {
    const result = serializeBlock(BLOCK);
    expect(result).toMatch(/^```chattermatter\n/);
    expect(result).toMatch(/\n```$/);
    expect(result).toContain('"id": "test-1"');
    expect(result).toContain('"type": "comment"');
  });

  it("preserves unknown fields for round-trip (§9)", () => {
    const block: Block = { ...BLOCK, custom_field: "preserved" };
    const result = serializeBlock(block);
    expect(result).toContain('"custom_field": "preserved"');
  });
});

describe("serializeBlocks", () => {
  it("separates blocks with blank lines", () => {
    const block2: Block = { id: "test-2", type: "question", content: "Why?" };
    const result = serializeBlocks([BLOCK, block2]);
    expect(result.split("```chattermatter")).toHaveLength(3); // 1 empty + 2 blocks
  });
});

describe("appendBlock", () => {
  it("appends a block to the end of a document", () => {
    const doc = "# Title\n\nSome content.\n";
    const result = appendBlock(doc, BLOCK);
    expect(result).toContain("# Title");
    expect(result).toContain("Some content.");
    expect(result).toContain("```chattermatter");
    expect(result).toContain('"id": "test-1"');
  });
});

describe("removeBlock", () => {
  it("removes a block by ID", () => {
    const doc = `# Title

\`\`\`chattermatter
{"id":"test-1","type":"comment","content":"Remove me"}
\`\`\`

Some text.
`;
    const result = removeBlock(doc, "test-1");
    expect(result).not.toContain("test-1");
    expect(result).toContain("# Title");
    expect(result).toContain("Some text.");
  });

  it("does not affect other blocks", () => {
    const doc = `\`\`\`chattermatter
{"id":"keep","type":"comment","content":"Keep me"}
\`\`\`

\`\`\`chattermatter
{"id":"remove","type":"comment","content":"Remove me"}
\`\`\`
`;
    const result = removeBlock(doc, "remove");
    expect(result).toContain("keep");
    expect(result).not.toContain('"remove"');
  });
});

describe("replaceBlock", () => {
  it("replaces a block in place", () => {
    const doc = `\`\`\`chattermatter
{"id":"test-1","type":"comment","content":"Original","status":"open"}
\`\`\`
`;
    const updated: Block = { ...BLOCK, status: "resolved" };
    const result = replaceBlock(doc, updated);
    expect(result).toContain('"resolved"');
    expect(result).not.toContain('"Original"');
  });

  it("appends if block not found", () => {
    const doc = "# Title\n";
    const result = replaceBlock(doc, BLOCK);
    expect(result).toContain("```chattermatter");
  });
});
