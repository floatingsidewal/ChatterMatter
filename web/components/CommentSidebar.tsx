"use client";

import { useState } from "react";
import type { CommentBlock } from "@/lib/store";

interface CommentSidebarProps {
  blocks: CommentBlock[];
  activeBlockId: string | null;
  onBlockClick: (blockId: string) => void;
  onResolve: (blockId: string) => void;
  onDelete: (blockId: string) => void;
  onReply: (parentId: string, content: string) => void;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  comment: { label: "Comment", color: "bg-blue-100 text-blue-800" },
  question: { label: "Question", color: "bg-purple-100 text-purple-800" },
  suggestion: { label: "Suggestion", color: "bg-green-100 text-green-800" },
  ai_feedback: { label: "AI Feedback", color: "bg-amber-100 text-amber-800" },
  reaction: { label: "Reaction", color: "bg-pink-100 text-pink-800" },
};

export default function CommentSidebar({
  blocks,
  activeBlockId,
  onBlockClick,
  onResolve,
  onDelete,
  onReply,
}: CommentSidebarProps) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");

  const filtered = blocks.filter((b) => {
    if (filter === "open") return (b.status ?? "open") === "open";
    if (filter === "resolved") return b.status === "resolved";
    return true;
  });

  // Group blocks: top-level first, then replies under their parents
  const topLevel = filtered.filter((b) => !b.parent_id);
  const replies = filtered.filter((b) => b.parent_id);
  const replyMap = new Map<string, CommentBlock[]>();
  for (const r of replies) {
    const pid = r.parent_id!;
    if (!replyMap.has(pid)) replyMap.set(pid, []);
    replyMap.get(pid)!.push(r);
  }

  const handleReplySubmit = (parentId: string) => {
    if (replyText.trim()) {
      onReply(parentId, replyText.trim());
      setReplyText("");
      setReplyingTo(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="font-semibold text-sm text-gray-700">
          Comments ({blocks.length})
        </h2>
        <div className="flex gap-1 mt-2">
          {(["all", "open", "resolved"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                filter === f
                  ? "bg-gray-800 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {topLevel.length === 0 && (
          <div className="p-4 text-sm text-gray-400 text-center">
            {filter === "all"
              ? "No comments yet. Select text in the document to add one."
              : `No ${filter} comments.`}
          </div>
        )}

        {topLevel.map((block) => (
          <div key={block.id}>
            <BlockCard
              block={block}
              isActive={activeBlockId === block.id}
              onClick={() => onBlockClick(block.id)}
              onResolve={() => onResolve(block.id)}
              onDelete={() => onDelete(block.id)}
              onReplyClick={() =>
                setReplyingTo(replyingTo === block.id ? null : block.id)
              }
            />

            {/* Replies */}
            {replyMap.get(block.id)?.map((reply) => (
              <div key={reply.id} className="ml-4 border-l-2 border-gray-100">
                <BlockCard
                  block={reply}
                  isActive={activeBlockId === reply.id}
                  onClick={() => onBlockClick(reply.id)}
                  onResolve={() => onResolve(reply.id)}
                  onDelete={() => onDelete(reply.id)}
                  onReplyClick={() => {}}
                  isReply
                />
              </div>
            ))}

            {/* Reply form */}
            {replyingTo === block.id && (
              <div className="ml-4 px-4 py-2 border-l-2 border-blue-200">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply..."
                  className="w-full text-sm border border-gray-200 rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
                  rows={2}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      handleReplySubmit(block.id);
                    }
                  }}
                />
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => handleReplySubmit(block.id)}
                    className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Reply
                  </button>
                  <button
                    onClick={() => {
                      setReplyingTo(null);
                      setReplyText("");
                    }}
                    className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BlockCard({
  block,
  isActive,
  onClick,
  onResolve,
  onDelete,
  onReplyClick,
  isReply = false,
}: {
  block: CommentBlock;
  isActive: boolean;
  onClick: () => void;
  onResolve: () => void;
  onDelete: () => void;
  onReplyClick: () => void;
  isReply?: boolean;
}) {
  const typeInfo = TYPE_LABELS[block.type] ?? {
    label: block.type,
    color: "bg-gray-100 text-gray-700",
  };
  const isResolved = block.status === "resolved";

  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors ${
        isActive ? "bg-yellow-50" : "hover:bg-gray-50"
      } ${isResolved ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${typeInfo.color}`}>
          {typeInfo.label}
        </span>
        {block.metadata?.confidence != null && (
          <span className="text-[10px] text-gray-400">
            {String(block.metadata.confidence)}
          </span>
        )}
        {isResolved && (
          <span className="text-[10px] text-green-600 font-medium">Resolved</span>
        )}
      </div>

      {block.anchor?.exact && (
        <div className="text-xs text-gray-400 truncate mb-1 italic">
          &ldquo;{block.anchor.exact.slice(0, 60)}
          {(block.anchor.exact.length ?? 0) > 60 ? "..." : ""}
          &rdquo;
        </div>
      )}

      <p className="text-sm text-gray-800 leading-snug">{block.content}</p>

      {block.author && (
        <div className="text-[10px] text-gray-400 mt-1.5">
          {block.author}
          {block.timestamp && (
            <>
              {" "}
              &middot;{" "}
              {new Date(block.timestamp).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-2">
        {!isResolved && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResolve();
            }}
            className="text-[10px] text-green-600 hover:text-green-800"
          >
            Resolve
          </button>
        )}
        {!isReply && !isResolved && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReplyClick();
            }}
            className="text-[10px] text-blue-600 hover:text-blue-800"
          >
            Reply
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-[10px] text-red-400 hover:text-red-600"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
