import { NextRequest, NextResponse } from "next/server";
import {
  loadBlocks,
  getCleanContent,
  addComment,
  resolveBlock as resolveBlockFn,
  deleteBlock,
  validate,
  buildThreads,
} from "chattermatter";
import type { Anchor, BlockType } from "chattermatter";

/**
 * POST /api/comments — parse, add, resolve, or delete comments.
 *
 * Actions:
 *   { action: "parse", markdown }
 *   { action: "add", markdown, content, type?, author?, anchor?, parent_id? }
 *   { action: "resolve", markdown, blockId }
 *   { action: "delete", markdown, blockId }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, markdown } = body;

    if (!markdown || typeof markdown !== "string") {
      return NextResponse.json(
        { error: "markdown is required" },
        { status: 400 },
      );
    }

    switch (action) {
      case "parse": {
        const { blocks, warnings } = loadBlocks(markdown);
        const cleanContent = getCleanContent(markdown);
        const validation = validate(markdown);
        const threads = buildThreads(blocks.map((b) => b.block));
        return NextResponse.json({
          cleanContent,
          blocks: blocks.map((b) => b.block),
          warnings: warnings.map((w) => w.message),
          validation,
          threads,
        });
      }

      case "add": {
        const { content, type, author, anchor, parent_id } = body;
        if (!content || typeof content !== "string") {
          return NextResponse.json(
            { error: "content is required for add" },
            { status: 400 },
          );
        }
        const result = addComment(markdown, {
          content,
          type: type as BlockType | undefined,
          author: author || "reviewer",
          anchor: anchor as Anchor | undefined,
          parent_id,
        });
        return NextResponse.json({
          markdown: result.markdown,
          block: result.block,
        });
      }

      case "resolve": {
        const { blockId } = body;
        if (!blockId) {
          return NextResponse.json(
            { error: "blockId is required for resolve" },
            { status: 400 },
          );
        }
        const updated = resolveBlockFn(markdown, blockId);
        return NextResponse.json({ markdown: updated });
      }

      case "delete": {
        const { blockId } = body;
        if (!blockId) {
          return NextResponse.json(
            { error: "blockId is required for delete" },
            { status: 400 },
          );
        }
        const updated = deleteBlock(markdown, blockId);
        return NextResponse.json({ markdown: updated });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
