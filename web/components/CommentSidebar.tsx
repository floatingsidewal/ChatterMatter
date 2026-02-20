"use client";

import { useActiveDocument, useStore } from "@/lib/store";
import type { Block, ThreadNode } from "@/lib/chattermatter";
import { useState } from "react";

const TYPE_COLORS: Record<string, string> = {
  comment: "bg-blue-100 text-blue-800",
  question: "bg-purple-100 text-purple-800",
  suggestion: "bg-green-100 text-green-800",
  ai_feedback: "bg-orange-100 text-orange-800",
  reaction: "bg-pink-100 text-pink-800",
};

const TYPE_LABELS: Record<string, string> = {
  comment: "Comment",
  question: "Question",
  suggestion: "Suggestion",
  ai_feedback: "AI Feedback",
  reaction: "Reaction",
};

interface CommentSidebarProps {
  activeBlockId: string | null;
  onBlockClick: (blockId: string) => void;
  onReply: (parentId: string) => void;
}

export function CommentSidebar({ activeBlockId, onBlockClick, onReply }: CommentSidebarProps) {
  const doc = useActiveDocument();
  const { dispatch } = useStore();
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");

  if (!doc) {
    return (
      <div className="p-4 text-gray-400 text-sm text-center">
        No document loaded
      </div>
    );
  }

  const filteredThreads = doc.threads.filter((t) => {
    if (filter === "all") return true;
    const status = t.block.status ?? "open";
    return status === filter;
  });

  const totalOpen = doc.blocks.filter((b) => (b.status ?? "open") === "open" && !b.parent_id).length;
  const totalResolved = doc.blocks.filter((b) => b.status === "resolved" && !b.parent_id).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header with counts */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700">Comments</h2>
          <span className="text-xs text-gray-500">{doc.blocks.length} total</span>
        </div>
        <div className="flex gap-1">
          {(["all", "open", "resolved"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {f === "all" ? `All` : f === "open" ? `Open (${totalOpen})` : `Resolved (${totalResolved})`}
            </button>
          ))}
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {filteredThreads.length === 0 ? (
          <div className="p-4 text-gray-400 text-sm text-center">
            {filter === "all"
              ? "No comments yet. Highlight text to add one."
              : `No ${filter} comments.`}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredThreads.map((thread) => (
              <ThreadItem
                key={thread.block.id}
                node={thread}
                depth={0}
                activeBlockId={activeBlockId}
                onBlockClick={onBlockClick}
                onReply={onReply}
                onResolve={(id) => dispatch({ type: "RESOLVE_BLOCK", blockId: id })}
                onDelete={(id) => dispatch({ type: "DELETE_BLOCK", blockId: id })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadItem({
  node,
  depth,
  activeBlockId,
  onBlockClick,
  onReply,
  onResolve,
  onDelete,
}: {
  node: ThreadNode;
  depth: number;
  activeBlockId: string | null;
  onBlockClick: (id: string) => void;
  onReply: (id: string) => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { block } = node;
  const isActive = block.id === activeBlockId;
  const isResolved = block.status === "resolved";

  return (
    <div>
      <div
        className={`px-4 py-3 cursor-pointer transition-colors ${
          isActive ? "bg-yellow-50 border-l-2 border-yellow-400" : "hover:bg-gray-50"
        } ${isResolved ? "opacity-60" : ""}`}
        style={{ paddingLeft: `${1 + depth * 1.25}rem` }}
        onClick={() => onBlockClick(block.id)}
      >
        {/* Type badge and author */}
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${TYPE_COLORS[block.type] ?? "bg-gray-100 text-gray-700"}`}>
            {TYPE_LABELS[block.type] ?? block.type}
          </span>
          {block.author && (
            <span className="text-xs text-gray-500 font-medium">{block.author}</span>
          )}
          {isResolved && (
            <span className="text-[10px] text-green-600 font-medium">Resolved</span>
          )}
        </div>

        {/* Content */}
        <p className="text-sm text-gray-700 line-clamp-3">{block.content}</p>

        {/* Suggestion diff preview */}
        {block.type === "suggestion" && block.suggestion && (
          <div className="mt-1.5 text-xs rounded overflow-hidden border border-gray-200">
            <div className="bg-red-50 text-red-800 px-2 py-1 line-through">
              {block.suggestion.original}
            </div>
            <div className="bg-green-50 text-green-800 px-2 py-1">
              {block.suggestion.replacement}
            </div>
          </div>
        )}

        {/* Anchor preview */}
        {block.anchor && block.anchor.type === "text" && (
          <div className="mt-1 text-xs text-gray-400 truncate">
            &ldquo;{block.anchor.exact}&rdquo;
          </div>
        )}

        {/* Timestamp */}
        {block.timestamp && (
          <div className="text-[10px] text-gray-400 mt-1">
            {formatTimestamp(block.timestamp)}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-2">
          <button
            onClick={(e) => { e.stopPropagation(); onReply(block.id); }}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            Reply
          </button>
          {!isResolved && (
            <button
              onClick={(e) => { e.stopPropagation(); onResolve(block.id); }}
              className="text-xs text-green-600 hover:text-green-800"
            >
              Resolve
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(block.id); }}
            className="text-xs text-red-500 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Children */}
      {node.children.map((child) => (
        <ThreadItem
          key={child.block.id}
          node={child}
          depth={depth + 1}
          activeBlockId={activeBlockId}
          onBlockClick={onBlockClick}
          onReply={onReply}
          onResolve={onResolve}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
