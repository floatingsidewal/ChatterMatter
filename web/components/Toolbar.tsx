"use client";

interface ToolbarProps {
  filename: string;
  selectedText: string;
  onAddComment: () => void;
  onAIReview: () => void;
  onDownload: () => void;
  onReset: () => void;
  isReviewing: boolean;
  showDashboard: boolean;
  onToggleDashboard: () => void;
}

export default function Toolbar({
  filename,
  selectedText,
  onAddComment,
  onAIReview,
  onDownload,
  onReset,
  isReviewing,
  showDashboard,
  onToggleDashboard,
}: ToolbarProps) {
  return (
    <header className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="font-bold text-sm tracking-tight">ChatterMatter</h1>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
          {filename}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onToggleDashboard}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
            showDashboard
              ? "bg-gray-800 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Dashboard
        </button>

        <button
          onClick={onAddComment}
          disabled={!selectedText}
          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            selectedText
              ? `Comment on: "${selectedText.slice(0, 30)}..."`
              : "Select text first"
          }
        >
          Add Comment
        </button>

        <button
          onClick={onAIReview}
          disabled={isReviewing}
          className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isReviewing ? "Reviewing..." : "AI Review"}
        </button>

        <button
          onClick={onDownload}
          className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
        >
          Download
        </button>

        <button
          onClick={onReset}
          className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600"
        >
          New File
        </button>
      </div>
    </header>
  );
}
