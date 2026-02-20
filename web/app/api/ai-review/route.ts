import { NextRequest, NextResponse } from "next/server";
import { parse, stripBlocks } from "../../../../src/parser";
import { appendBlock } from "../../../../src/serializer";
import type { Block } from "../../../../src/types";
import { randomUUID } from "node:crypto";

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

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY environment variable is not set. AI review is unavailable." },
      { status: 503 },
    );
  }

  let body: { markdown: string; instructions?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.markdown || typeof body.markdown !== "string") {
    return NextResponse.json({ error: "markdown field is required" }, { status: 400 });
  }

  const clean = stripBlocks(body.markdown);
  const model = "claude-sonnet-4-20250514";
  const author = "ai-reviewer";

  const userPrompt = body.instructions
    ? `Review the following document. Additional instructions: ${body.instructions}\n\n---\n\n${clean}`
    : `Review the following document:\n\n---\n\n${clean}`;

  try {
    let Anthropic: any;
    try {
      // Dynamic import with webpackIgnore so the build doesn't fail when the SDK isn't installed
      // @ts-expect-error -- optional dependency, may not be installed
      Anthropic = (await import(/* webpackIgnore: true */ "@anthropic-ai/sdk")).default;
    } catch {
      return NextResponse.json(
        { error: "The @anthropic-ai/sdk package is not installed. Run: npm install @anthropic-ai/sdk" },
        { status: 503 },
      );
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");

    const blocks = parseReviewResponse(text, author, model);

    // Append all AI feedback blocks to the markdown
    let markdown = body.markdown;
    for (const block of blocks) {
      markdown = appendBlock(markdown, block);
    }

    return NextResponse.json({ markdown, blocks, rawResponse: text });
  } catch (e: any) {
    return NextResponse.json(
      { error: `AI review error: ${e.message}` },
      { status: 500 },
    );
  }
}

function parseReviewResponse(text: string, author: string, model: string): Block[] {
  let jsonStr = text.trim();

  const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let items: unknown[];
  try {
    items = JSON.parse(jsonStr);
  } catch {
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

  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null,
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
        block.anchor = { type: "text", exact: item.anchor_text };
      }

      return block;
    });
}
