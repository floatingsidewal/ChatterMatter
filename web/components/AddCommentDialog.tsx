"use client";

import { useState, useRef, useEffect } from "react";
import { useStore } from "@/lib/store";
import type { BlockType, Anchor } from "@/lib/chattermatter";

interface AddCommentDialogProps {
  /** The text the user selected, used to create a text anchor. */
  selectedText?: string;
  /** Parent block ID if this is a reply. */
  parentId?: string;
  /** Screen position for the popover (if triggered by selection). */
  position?: { top: number; left: number };
  onClose: () => void;
}

const BLOCK_TYPE_OPTIONS: Array<{ value: BlockType; label: string }> = [
  { value: "comment", label: "Comment" },
  { value: "question", label: "Question" },
  { value: "suggestion", label: "Suggestion" },
];

export function AddCommentDialog({
  selectedText,
  parentId,
  position,
  onClose,
}: AddCommentDialogProps) {
  const { dispatch } = useStore();
  const [content, setContent] = useState("");
  const [blockType, setBlockType] = useState<BlockType>("comment");
  const [replacement, setReplacement] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!content.trim() && blockType !== "suggestion") return;

    const anchor: Anchor | undefined = selectedText
      ? { type: "text", exact: selectedText }
      : undefined;

    dispatch({
      type: "ADD_COMMENT",
      content: content.trim(),
      blockType,
      anchor,
      parentId,
      suggestion:
        blockType === "suggestion" && selectedText
          ? { original: selectedText, replacement }
          : undefined,
    });

    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  };

  // Inline popover style (anchored near selection)
  const style = position
    ? {
        position: "fixed" as const,
        top: position.top,
        left: position.left,
        zIndex: 50,
      }
    : undefined;

  return (
    <>
      {/* Backdrop for modal mode */}
      {!position && (
        <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      )}

      <div
        className={`bg-white rounded-xl shadow-xl border border-gray-200 w-80 selection-popover ${
          position ? "" : "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
        }`}
        style={style}
        onKeyDown={handleKeyDown}
      >
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">
              {parentId ? "Reply" : "Add Comment"}
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
              &times;
            </button>
          </div>

          {/* Selected text preview */}
          {selectedText && (
            <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded-md text-xs text-gray-600 line-clamp-2">
              &ldquo;{selectedText}&rdquo;
            </div>
          )}

          {/* Type selector (not for replies) */}
          {!parentId && (
            <div className="flex gap-1 mb-3">
              {BLOCK_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setBlockType(opt.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    blockType === opt.value
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Content textarea */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              blockType === "suggestion"
                ? "Explain the suggestion..."
                : blockType === "question"
                  ? "Ask a question..."
                  : "Write a comment..."
            }
            className="w-full h-20 border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          />

          {/* Suggestion replacement field */}
          {blockType === "suggestion" && selectedText && (
            <div className="mt-2">
              <label className="text-xs text-gray-500 mb-1 block">
                Replace with:
              </label>
              <textarea
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="Suggested replacement text..."
                className="w-full h-16 border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
              />
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!content.trim() && blockType !== "suggestion"}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {parentId ? "Reply" : "Add"}
            </button>
          </div>

          <div className="text-[10px] text-gray-400 mt-2 text-right">
            Ctrl+Enter to submit
          </div>
        </div>
      </div>
    </>
  );
}
