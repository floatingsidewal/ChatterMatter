"use client";

import { useState, useCallback } from "react";
import { useActiveDocument } from "@/lib/store";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { CommentSidebar } from "@/components/CommentSidebar";
import { SelectionPopover } from "@/components/SelectionPopover";
import { AddCommentDialog } from "@/components/AddCommentDialog";
import { ReviewToolbar } from "@/components/ReviewToolbar";
import Link from "next/link";

interface SelectionInfo {
  text: string;
  rect: DOMRect;
}

export default function ReviewPage() {
  const doc = useActiveDocument();
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [showCommentDialog, setShowCommentDialog] = useState(false);
  const [commentDialogAnchorText, setCommentDialogAnchorText] = useState<string | undefined>();
  const [commentDialogPosition, setCommentDialogPosition] = useState<{ top: number; left: number } | undefined>();
  const [replyToId, setReplyToId] = useState<string | undefined>();
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  const handleSelectionChange = useCallback((sel: SelectionInfo | null) => {
    setSelection(sel);
    if (!sel) {
      // Don't close if comment dialog is open
    }
  }, []);

  const handleAddCommentFromSelection = useCallback(() => {
    if (!selection) return;
    setCommentDialogAnchorText(selection.text);
    setCommentDialogPosition({
      top: selection.rect.bottom + 8,
      left: Math.max(16, Math.min(selection.rect.left, window.innerWidth - 340)),
    });
    setReplyToId(undefined);
    setShowCommentDialog(true);
    setSelection(null);
  }, [selection]);

  const handleReply = useCallback((parentId: string) => {
    setReplyToId(parentId);
    setCommentDialogAnchorText(undefined);
    setCommentDialogPosition(undefined);
    setShowCommentDialog(true);
  }, []);

  const closeDialog = useCallback(() => {
    setShowCommentDialog(false);
    setCommentDialogAnchorText(undefined);
    setCommentDialogPosition(undefined);
    setReplyToId(undefined);
  }, []);

  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-56px)] text-gray-500">
        <p className="mb-4">No document loaded.</p>
        <Link
          href="/"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Upload a document
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      <ReviewToolbar />
      <div className="flex flex-1 overflow-hidden">
        {/* Document pane */}
        <div className="flex-1 overflow-y-auto relative">
          <MarkdownRenderer
            onSelectionChange={handleSelectionChange}
            activeBlockId={activeBlockId}
            onBlockClick={setActiveBlockId}
          />

          {/* Selection popover */}
          {selection && !showCommentDialog && (
            <SelectionPopover
              rect={selection.rect}
              onAddComment={handleAddCommentFromSelection}
            />
          )}
        </div>

        {/* Comment sidebar */}
        <div className="w-80 border-l border-gray-200 bg-white overflow-hidden flex flex-col">
          <CommentSidebar
            activeBlockId={activeBlockId}
            onBlockClick={setActiveBlockId}
            onReply={handleReply}
          />
        </div>
      </div>

      {/* Add comment dialog */}
      {showCommentDialog && (
        <AddCommentDialog
          selectedText={commentDialogAnchorText}
          parentId={replyToId}
          position={commentDialogPosition}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
