import { describe, it, expect } from "vitest";
import { resolveAnchor } from "../src/anchor.js";
import type { TextAnchor, HeadingAnchor, BlockIndexAnchor } from "../src/types.js";

const DOC = `# Introduction

This paragraph introduces the idea and sets the tone for the rest of the document.

## Details

Here we discuss the details of the proposal. The idea is explained further.

### Rollback Plan

If something goes wrong, the system will automatically retry up to three times.
`;

describe("resolveAnchor — text (§5.1)", () => {
  it("resolves a unique text match", () => {
    const anchor: TextAnchor = { type: "text", exact: "sets the tone" };
    const result = resolveAnchor(anchor, DOC);
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(DOC.slice(result.result.offset, result.result.offset + result.result.length)).toBe("sets the tone");
      expect(result.result.usedFallback).toBe(false);
    }
  });

  it("resolves first match when text appears multiple times", () => {
    // "the idea" appears in paragraph 1 and paragraph 2
    const anchor: TextAnchor = { type: "text", exact: "the idea" };
    const result = resolveAnchor(anchor, DOC);
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      // Should be the first occurrence
      expect(result.result.offset).toBe(DOC.indexOf("the idea"));
    }
  });

  it("uses context_before for disambiguation", () => {
    const anchor: TextAnchor = {
      type: "text",
      exact: "the idea",
      context_before: "The ",
    };
    const result = resolveAnchor(anchor, DOC);
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      // Should match "The idea" in the second paragraph context
      const matchedText = DOC.slice(result.result.offset, result.result.offset + result.result.length);
      expect(matchedText).toBe("the idea");
    }
  });

  it("returns unresolved for non-existent text", () => {
    const anchor: TextAnchor = { type: "text", exact: "this text does not exist" };
    const result = resolveAnchor(anchor, DOC);
    expect(result.resolved).toBe(false);
  });
});

describe("resolveAnchor — heading (§5.2)", () => {
  it("resolves a heading by text", () => {
    const anchor: HeadingAnchor = { type: "heading", text: "Details" };
    const result = resolveAnchor(anchor, DOC);
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(DOC.slice(result.result.offset, result.result.offset + result.result.length)).toBe("## Details");
    }
  });

  it("resolves a heading by text and level", () => {
    const anchor: HeadingAnchor = { type: "heading", text: "Rollback Plan", level: 3 };
    const result = resolveAnchor(anchor, DOC);
    expect(result.resolved).toBe(true);
  });

  it("returns unresolved for wrong level", () => {
    const anchor: HeadingAnchor = { type: "heading", text: "Rollback Plan", level: 2 };
    const result = resolveAnchor(anchor, DOC);
    expect(result.resolved).toBe(false);
  });

  it("returns unresolved for non-existent heading", () => {
    const anchor: HeadingAnchor = { type: "heading", text: "Nonexistent" };
    const result = resolveAnchor(anchor, DOC);
    expect(result.resolved).toBe(false);
  });
});

describe("resolveAnchor — block_index (§5.3)", () => {
  it("resolves block by index", () => {
    const anchor: BlockIndexAnchor = { type: "block_index", index: 0 };
    const result = resolveAnchor(anchor, DOC);
    expect(result.resolved).toBe(true);
  });

  it("returns unresolved for out-of-bounds index", () => {
    const anchor: BlockIndexAnchor = { type: "block_index", index: 999 };
    const result = resolveAnchor(anchor, DOC);
    expect(result.resolved).toBe(false);
  });
});

describe("resolveAnchor — composite with fallback (§5.4)", () => {
  it("uses fallback when primary fails", () => {
    const anchor: TextAnchor = {
      type: "text",
      exact: "nonexistent text",
      fallback: { type: "heading", text: "Details" },
    };
    const result = resolveAnchor(anchor, DOC);
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.result.usedFallback).toBe(true);
    }
  });

  it("prefers primary when it resolves", () => {
    const anchor: TextAnchor = {
      type: "text",
      exact: "sets the tone",
      fallback: { type: "heading", text: "Details" },
    };
    const result = resolveAnchor(anchor, DOC);
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.result.usedFallback).toBe(false);
    }
  });
});
