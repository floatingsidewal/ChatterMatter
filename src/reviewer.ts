/**
 * ChatterMatter AI reviewer — sends a document to Claude for structured review.
 *
 * Produces `ai_feedback` blocks anchored to specific locations in the document.
 */

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { stripBlocks } from "./parser.js";
import { serializeBlock } from "./serializer.js";
import type { Block } from "./types.js";

export interface ReviewOptions {
  /** The Markdown content to review. */
  markdown: string;
  /** The model to use. Defaults to "claude-sonnet-4-20250514". */
  model?: string;
  /** Optional custom instructions for the reviewer. */
  instructions?: string;
  /** Author name to use for the AI reviewer blocks. Defaults to "ai-reviewer". */
  author?: string;
  /** Anthropic API key. Uses ANTHROPIC_API_KEY env var if not provided. */
  apiKey?: string;
}

export interface ReviewResult {
  blocks: Block[];
  /** The raw model response for debugging. */
  rawResponse?: string;
}

const SYSTEM_PROMPT = `You are a document reviewer. You read Markdown documents and provide structured feedback as ChatterMatter blocks — JSON objects that anchor comments to specific locations in the document.

Your review should cover:
- **Clarity**: Is the writing clear and unambiguous?
- **Completeness**: Are there gaps, missing sections, or unanswered questions?
- **Consistency**: Are terms, style, and formatting used consistently?
- **Accuracy**: Are claims supported? Are there logical errors?
- **Structure**: Is the document well-organized?

For each piece of feedback, output a JSON object with this exact structure:
{
  "type": "ai_feedback",
  "anchor_text": "<exact text from the document to anchor this comment to>",
  "content": "<your feedback>",
  "category": "<one of: clarity, completeness, consistency, accuracy, structure>",
  "confidence": "<one of: high, medium, low>"
}

Rules:
- Output ONLY a JSON array of these objects, nothing else
- The "anchor_text" MUST be an exact substring from the document (copy-paste precision)
- Keep each comment focused on a single issue
- Be specific and actionable — say what should change, not just that something is wrong
- Skip trivial issues (typos, minor style preferences)
- Focus on substantive feedback that improves the document
- Aim for 3-8 comments depending on document length and quality
- If the document is excellent, it's fine to return fewer comments`;

/**
 * Review a Markdown document using Claude and return ChatterMatter blocks.
 */
export async function reviewDocument(options: ReviewOptions): Promise<ReviewResult> {
  const clean = stripBlocks(options.markdown);
  const model = options.model ?? "claude-sonnet-4-20250514";
  const author = options.author ?? "ai-reviewer";

  const client = new Anthropic({
    apiKey: options.apiKey,
  });

  const userPrompt = options.instructions
    ? `Review the following document. Additional instructions: ${options.instructions}\n\n---\n\n${clean}`
    : `Review the following document:\n\n---\n\n${clean}`;

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");

  const blocks = parseReviewResponse(text, author, model);

  return { blocks, rawResponse: text };
}

/**
 * Parse the AI's JSON array response into ChatterMatter blocks.
 */
function parseReviewResponse(text: string, author: string, model: string): Block[] {
  // Extract JSON array from the response (may be wrapped in markdown code fences)
  let jsonStr = text.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let items: unknown[];
  try {
    items = JSON.parse(jsonStr);
  } catch {
    // Try to extract array from the response if it has extra text
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        items = JSON.parse(arrayMatch[0]);
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }

  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null
    )
    .map((item) => {
      const block: Block = {
        id: randomUUID(),
        type: "ai_feedback",
        content: String(item.content ?? ""),
        author,
        timestamp: new Date().toISOString(),
        status: "open",
        spec_version: "0.1",
        metadata: {
          model,
          confidence: String(item.confidence ?? "medium"),
          category: String(item.category ?? "general"),
        },
      };

      if (typeof item.anchor_text === "string" && item.anchor_text) {
        block.anchor = {
          type: "text",
          exact: item.anchor_text,
        };
      }

      return block;
    });
}

/**
 * Format review results as a human-readable summary.
 */
export function formatReviewSummary(blocks: Block[]): string {
  if (blocks.length === 0) {
    return "No issues found.";
  }

  const lines: string[] = [];
  lines.push(`Found ${blocks.length} issue(s):\n`);

  for (const block of blocks) {
    const category = (block.metadata?.category as string) ?? "general";
    const confidence = (block.metadata?.confidence as string) ?? "medium";
    const anchor = block.anchor?.type === "text"
      ? ` (at: "${block.anchor.exact.slice(0, 50)}${block.anchor.exact.length > 50 ? "..." : ""}")`
      : "";

    lines.push(`  [${category}/${confidence}]${anchor}`);
    lines.push(`    ${block.content}`);
    lines.push("");
  }

  return lines.join("\n");
}
