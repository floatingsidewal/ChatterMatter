import { NextRequest, NextResponse } from "next/server";
import { reviewDocument, formatReviewSummary } from "chattermatter";
import { appendBlock } from "chattermatter";

/**
 * POST /api/review — run AI review on a Markdown document.
 *
 * Body: { markdown, instructions?, model? }
 * Returns: { markdown (with review blocks appended), blocks, summary }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { markdown, instructions, model } = body;

    if (!markdown || typeof markdown !== "string") {
      return NextResponse.json(
        { error: "markdown is required" },
        { status: 400 },
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY environment variable is not set" },
        { status: 500 },
      );
    }

    const result = await reviewDocument({
      markdown,
      instructions,
      model,
      apiKey,
    });

    // Append review blocks to the document
    let updatedMarkdown = markdown;
    for (const block of result.blocks) {
      updatedMarkdown = appendBlock(updatedMarkdown, block);
    }

    const summary = formatReviewSummary(result.blocks);

    return NextResponse.json({
      markdown: updatedMarkdown,
      blocks: result.blocks,
      summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
