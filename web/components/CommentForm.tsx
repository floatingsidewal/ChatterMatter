"use client";

import { useState } from "react";

interface CommentFormProps {
  selectedText: string;
  onSubmit: (data: {
    content: string;
    type: string;
    author: string;
    anchor: { type: "text"; exact: string } | null;
  }) => void;
  onCancel: () => void;
}

const COMMENT_TYPES = [
  { value: "comment", label: "Comment" },
  { value: "question", label: "Question" },
  { value: "suggestion", label: "Suggestion" },
];

export default function CommentForm({
  selectedText,
  onSubmit,
  onCancel,
}: CommentFormProps) {
  const [content, setContent] = useState("");
  const [type, setType] = useState("comment");
  const [author, setAuthor] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    onSubmit({
      content: content.trim(),
      type,
      author: author.trim() || "reviewer",
      anchor: selectedText ? { type: "text", exact: selectedText } : null,
    });
    setContent("");
  };

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4"
      >
        <h3 className="font-semibold text-gray-900 mb-3">Add Comment</h3>

        {selectedText && (
          <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-gray-600 italic">
            &ldquo;{selectedText.slice(0, 120)}
            {selectedText.length > 120 ? "..." : ""}&rdquo;
          </div>
        )}

        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">Type</label>
          <div className="flex gap-2">
            {COMMENT_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={`px-3 py-1 text-xs rounded-full transition-colors ${
                  type === t.value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">Author</label>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="reviewer"
            className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Comment</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your comment..."
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleSubmit(e);
              }
            }}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!content.trim()}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add Comment
          </button>
        </div>
      </form>
    </div>
  );
}
