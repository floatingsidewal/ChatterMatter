import { describe, it, expect } from "vitest";
import { validateBlock, validateBlocks, isValidReaction } from "../src/validator.js";
import type { Block } from "../src/types.js";

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: "test-1",
    type: "comment",
    content: "Test comment",
    ...overrides,
  };
}

describe("validateBlock", () => {
  it("accepts a minimal valid block", () => {
    const result = validateBlock(makeBlock());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects empty id", () => {
    const result = validateBlock(makeBlock({ id: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "id")).toBe(true);
  });

  it("rejects non-printable ASCII in id (§10.1)", () => {
    const result = validateBlock(makeBlock({ id: "has spaces" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "id")).toBe(true);
  });

  it("accepts printable ASCII id", () => {
    const result = validateBlock(makeBlock({ id: "abc-123_XYZ" }));
    expect(result.valid).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = validateBlock(makeBlock({ status: "pending" as any }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "status")).toBe(true);
  });

  it("accepts valid statuses", () => {
    expect(validateBlock(makeBlock({ status: "open" })).valid).toBe(true);
    expect(validateBlock(makeBlock({ status: "resolved" })).valid).toBe(true);
  });

  it("requires suggestion object for suggestion type (§4.4)", () => {
    const result = validateBlock(makeBlock({ type: "suggestion" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "suggestion")).toBe(true);
  });

  it("accepts valid suggestion block", () => {
    const result = validateBlock(
      makeBlock({
        type: "suggestion",
        suggestion: { original: "old text", replacement: "new text" },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("requires parent_id for reactions (§4.6)", () => {
    const result = validateBlock(makeBlock({ type: "reaction", content: "👍" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "parent_id")).toBe(true);
  });

  it("rejects invalid reaction content (§4.6)", () => {
    const result = validateBlock(
      makeBlock({ type: "reaction", content: "this is too long", parent_id: "p1" }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "content")).toBe(true);
  });

  it("accepts valid reaction content", () => {
    expect(
      validateBlock(makeBlock({ type: "reaction", content: "👍", parent_id: "p1" })).valid,
    ).toBe(true);
    expect(
      validateBlock(makeBlock({ type: "reaction", content: "+1", parent_id: "p1" })).valid,
    ).toBe(true);
    expect(
      validateBlock(makeBlock({ type: "reaction", content: "agree", parent_id: "p1" })).valid,
    ).toBe(true);
  });

  it("validates anchor structure", () => {
    const result = validateBlock(
      makeBlock({ anchor: { type: "text", exact: "" } as any }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "anchor.exact")).toBe(true);
  });

  it("validates heading anchor", () => {
    const result = validateBlock(
      makeBlock({ anchor: { type: "heading", text: "Valid", level: 7 } as any }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "anchor.level")).toBe(true);
  });

  it("validates block_index anchor", () => {
    const result = validateBlock(
      makeBlock({ anchor: { type: "block_index", index: -1 } as any }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "anchor.index")).toBe(true);
  });

  it("rejects invalid timestamp", () => {
    const result = validateBlock(makeBlock({ timestamp: "not-a-date" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "timestamp")).toBe(true);
  });
});

describe("validateBlocks", () => {
  it("detects duplicate IDs (§10.2)", () => {
    const blocks = [
      makeBlock({ id: "dup" }),
      makeBlock({ id: "dup", content: "second" }),
    ];
    const result = validateBlocks(blocks);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("duplicate"))).toBe(true);
  });

  it("detects orphaned parent_id (§6)", () => {
    const blocks = [makeBlock({ id: "c1", parent_id: "nonexistent" })];
    const result = validateBlocks(blocks);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("non-existent"))).toBe(true);
  });

  it("detects circular references (§6)", () => {
    const blocks = [
      makeBlock({ id: "a", parent_id: "b" }),
      makeBlock({ id: "b", parent_id: "a" }),
    ];
    const result = validateBlocks(blocks);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("circular"))).toBe(true);
  });

  it("accepts a valid set of blocks", () => {
    const blocks = [
      makeBlock({ id: "c1" }),
      makeBlock({ id: "c2", parent_id: "c1" }),
    ];
    const result = validateBlocks(blocks);
    expect(result.valid).toBe(true);
  });
});

describe("isValidReaction", () => {
  it("accepts predefined strings", () => {
    expect(isValidReaction("+1")).toBe(true);
    expect(isValidReaction("-1")).toBe(true);
    expect(isValidReaction("agree")).toBe(true);
    expect(isValidReaction("disagree")).toBe(true);
  });

  it("accepts emoji", () => {
    expect(isValidReaction("👍")).toBe(true);
    expect(isValidReaction("🎉")).toBe(true);
  });

  it("rejects arbitrary text", () => {
    expect(isValidReaction("hello world")).toBe(false);
    expect(isValidReaction("this is not a reaction")).toBe(false);
  });
});
