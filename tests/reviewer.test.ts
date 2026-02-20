import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatReviewSummary } from "../src/reviewer.js";
import type { Block } from "../src/types.js";

/**
 * Tests for the reviewer module.
 *
 * Note: reviewDocument() requires a real API key and makes network calls,
 * so we test the response parsing and formatting logic that doesn't need the API.
 * Integration testing with the actual API is done manually.
 */

function makeAIBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: "test-ai-1",
    type: "ai_feedback",
    content: "This section could be clearer.",
    author: "ai-reviewer",
    status: "open",
    metadata: {
      model: "claude-sonnet-4-20250514",
      confidence: "high",
      category: "clarity",
    },
    anchor: { type: "text", exact: "introduces the idea" },
    ...overrides,
  };
}

describe("formatReviewSummary", () => {
  it("formats empty results", () => {
    const summary = formatReviewSummary([]);
    expect(summary).toBe("No issues found.");
  });

  it("formats single block", () => {
    const blocks = [makeAIBlock()];
    const summary = formatReviewSummary(blocks);
    expect(summary).toContain("1 issue(s)");
    expect(summary).toContain("[clarity/high]");
    expect(summary).toContain("introduces the idea");
    expect(summary).toContain("This section could be clearer.");
  });

  it("formats multiple blocks", () => {
    const blocks = [
      makeAIBlock({ id: "a1", content: "First issue" }),
      makeAIBlock({
        id: "a2",
        content: "Second issue",
        metadata: { model: "test", confidence: "low", category: "completeness" },
      }),
    ];
    const summary = formatReviewSummary(blocks);
    expect(summary).toContain("2 issue(s)");
    expect(summary).toContain("First issue");
    expect(summary).toContain("Second issue");
    expect(summary).toContain("[completeness/low]");
  });

  it("handles blocks without anchors", () => {
    const block = makeAIBlock({ anchor: undefined });
    const summary = formatReviewSummary([block]);
    expect(summary).toContain("1 issue(s)");
    expect(summary).not.toContain("(at:");
  });

  it("truncates long anchor text", () => {
    const longText = "a".repeat(100);
    const block = makeAIBlock({
      anchor: { type: "text", exact: longText },
    });
    const summary = formatReviewSummary([block]);
    expect(summary).toContain("...");
  });
});

describe("reviewer block structure", () => {
  it("AI blocks have correct type and metadata shape", () => {
    const block = makeAIBlock();
    expect(block.type).toBe("ai_feedback");
    expect(block.metadata).toBeDefined();
    expect(block.metadata?.model).toBe("claude-sonnet-4-20250514");
    expect(block.metadata?.confidence).toBe("high");
    expect(block.metadata?.category).toBe("clarity");
  });

  it("AI blocks have valid anchor", () => {
    const block = makeAIBlock();
    expect(block.anchor?.type).toBe("text");
    if (block.anchor?.type === "text") {
      expect(block.anchor.exact).toBe("introduces the idea");
    }
  });
});
