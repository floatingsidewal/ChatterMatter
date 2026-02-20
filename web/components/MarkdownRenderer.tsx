"use client";

import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useActiveDocument, useStore } from "@/lib/store";
import { resolveBlockAnchor, type Block, type AnchorResolution } from "@/lib/chattermatter";

interface ResolvedBlock {
  block: Block;
  resolution: AnchorResolution;
}

interface SelectionInfo {
  text: string;
  rect: DOMRect;
}

interface MarkdownRendererProps {
  onSelectionChange: (selection: SelectionInfo | null) => void;
  activeBlockId: string | null;
  onBlockClick: (blockId: string) => void;
}

export function MarkdownRenderer({
  onSelectionChange,
  activeBlockId,
  onBlockClick,
}: MarkdownRendererProps) {
  const doc = useActiveDocument();
  const contentRef = useRef<HTMLDivElement>(null);
  const [highlights, setHighlights] = useState<
    Array<{ blockId: string; offset: number; length: number }>
  >([]);

  // Resolve all block anchors against the clean content
  const resolvedBlocks = useMemo(() => {
    if (!doc) return [];
    return doc.blocks
      .filter((b) => b.anchor && (b.status ?? "open") === "open")
      .map((block) => ({
        block,
        resolution: resolveBlockAnchor(block, doc.markdown),
      }))
      .filter((rb): rb is ResolvedBlock & { resolution: { resolved: true; result: { offset: number; length: number } } } =>
        rb.resolution.resolved === true,
      );
  }, [doc]);

  // Handle text selection for adding comments
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !contentRef.current) {
      // Delay clearing to allow click handlers on the popover to fire
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          onSelectionChange(null);
        }
      }, 200);
      return;
    }

    // Only count selections within the content area
    if (!contentRef.current.contains(selection.anchorNode)) return;

    const text = selection.toString().trim();
    if (!text) {
      onSelectionChange(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    onSelectionChange({ text, rect });
  }, [onSelectionChange]);

  if (!doc) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        No document loaded
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className="prose max-w-none px-8 py-6"
        onMouseUp={handleMouseUp}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {doc.cleanContent}
        </ReactMarkdown>
      </div>
    </div>
  );
}
