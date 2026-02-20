import { describe, it, expect } from "vitest";
import { parse, stripBlocks } from "../src/parser.js";

const SAMPLE_DOC = `# My Document

This paragraph introduces the idea and sets the tone.

\`\`\`chattermatter
{
  "id": "c1",
  "type": "comment",
  "author": "alice",
  "content": "Consider strengthening this opening.",
  "anchor": { "type": "text", "exact": "introduces the idea" },
  "status": "open"
}
\`\`\`

Another paragraph here.

\`\`\`chattermatter
{
  "id": "c2",
  "type": "question",
  "content": "Should this be expanded?",
  "anchor": { "type": "heading", "text": "My Document" }
}
\`\`\`
`;

describe("parse", () => {
  it("extracts fenced code blocks", () => {
    const result = parse(SAMPLE_DOC);
    expect(result.blocks).toHaveLength(2);
    expect(result.warnings).toHaveLength(0);
  });

  it("preserves block order", () => {
    const result = parse(SAMPLE_DOC);
    expect(result.blocks[0].block.id).toBe("c1");
    expect(result.blocks[1].block.id).toBe("c2");
    expect(result.blocks[0].documentIndex).toBe(0);
    expect(result.blocks[1].documentIndex).toBe(1);
  });

  it("parses all fields correctly", () => {
    const result = parse(SAMPLE_DOC);
    const block = result.blocks[0].block;
    expect(block.id).toBe("c1");
    expect(block.type).toBe("comment");
    expect(block.author).toBe("alice");
    expect(block.content).toBe("Consider strengthening this opening.");
    expect(block.status).toBe("open");
    expect(block.anchor).toEqual({ type: "text", exact: "introduces the idea" });
  });

  it("warns on malformed JSON", () => {
    const doc = "```chattermatter\n{not valid json}\n```";
    const result = parse(doc);
    expect(result.blocks).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("Malformed JSON");
  });

  it("warns on missing required fields", () => {
    const doc = '```chattermatter\n{"id": "x"}\n```';
    const result = parse(doc);
    expect(result.blocks).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("missing required field");
  });

  it("parses HTML comment blocks", () => {
    const doc = '<!--chattermatter {"id":"h1","type":"comment","content":"hello"} -->';
    const result = parse(doc);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block.id).toBe("h1");
  });

  it("rejects HTML comment blocks containing -->", () => {
    // The regex matches the first -->, truncating the JSON payload.
    // The parser then sees malformed JSON and warns accordingly.
    const doc = '<!--chattermatter {"id":"h1","type":"comment","content":"has --> in it"} -->';
    const result = parse(doc);
    expect(result.blocks).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("Malformed JSON");
  });

  it("handles empty document", () => {
    const result = parse("");
    expect(result.blocks).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("handles document with no chattermatter blocks", () => {
    const result = parse("# Just a heading\n\nSome text.\n");
    expect(result.blocks).toHaveLength(0);
  });

  it("preserves unknown fields for round-trip (§9)", () => {
    const doc = '```chattermatter\n{"id":"r1","type":"comment","content":"hi","custom_field":"preserved"}\n```';
    const result = parse(doc);
    expect(result.blocks[0].block.custom_field).toBe("preserved");
  });
});

describe("stripBlocks", () => {
  it("removes all chattermatter blocks", () => {
    const clean = stripBlocks(SAMPLE_DOC);
    expect(clean).not.toContain("chattermatter");
    expect(clean).not.toContain("c1");
    expect(clean).toContain("# My Document");
    expect(clean).toContain("introduces the idea");
    expect(clean).toContain("Another paragraph here.");
  });

  it("collapses excess blank lines", () => {
    const clean = stripBlocks(SAMPLE_DOC);
    expect(clean).not.toMatch(/\n{3,}/);
  });

  it("returns clean document with trailing newline", () => {
    const clean = stripBlocks(SAMPLE_DOC);
    expect(clean.endsWith("\n")).toBe(true);
  });
});
