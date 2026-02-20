"use client";

import { useCallback, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CommentBlock } from "@/lib/store";

interface MarkdownViewerProps {
  content: string;
  blocks: CommentBlock[];
  activeBlockId: string | null;
  onBlockClick: (blockId: string) => void;
  onTextSelected: (text: string) => void;
}

export default function MarkdownViewer({
  content,
  blocks,
  activeBlockId,
  onBlockClick,
  onTextSelected,
}: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle text selection for adding comments
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const text = selection.toString().trim();
    if (text.length > 0) {
      onTextSelected(text);
    }
  }, [onTextSelected]);

  // Apply highlights to the rendered content
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    // Remove existing highlights
    container.querySelectorAll(".comment-highlight").forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ""), el);
        parent.normalize();
      }
    });

    // Apply highlights for blocks with text anchors
    const textAnchors = blocks.filter(
      (b) => b.anchor?.type === "text" && b.anchor.exact && b.status !== "resolved",
    );

    for (const block of textAnchors) {
      const exact = block.anchor!.exact!;
      highlightTextInNode(container, exact, block.id, block.id === activeBlockId);
    }
  }, [content, blocks, activeBlockId]);

  return (
    <div
      ref={containerRef}
      className="markdown-body prose prose-gray max-w-none p-6"
      onMouseUp={handleMouseUp}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

/**
 * Walk the DOM tree and wrap the first occurrence of `text` in a highlight span.
 */
function highlightTextInNode(
  root: HTMLElement,
  text: string,
  blockId: string,
  isActive: boolean,
) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    textNodes.push(node);
  }

  // Try single-node match first
  for (const textNode of textNodes) {
    const nodeText = textNode.textContent || "";
    const idx = nodeText.indexOf(text);
    if (idx === -1) continue;

    const range = document.createRange();
    range.setStart(textNode, idx);
    range.setEnd(textNode, idx + text.length);

    const span = document.createElement("span");
    span.className = `comment-highlight${isActive ? " active" : ""}`;
    span.dataset.blockId = blockId;
    span.addEventListener("click", () => {
      document.dispatchEvent(
        new CustomEvent("chattermatter:block-click", { detail: blockId }),
      );
    });

    range.surroundContents(span);
    return; // Only highlight first occurrence
  }
}
