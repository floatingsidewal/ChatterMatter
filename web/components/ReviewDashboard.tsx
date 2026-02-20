"use client";

import type { CommentBlock } from "@/lib/store";

interface ReviewDashboardProps {
  blocks: CommentBlock[];
  filename: string;
}

export default function ReviewDashboard({
  blocks,
  filename,
}: ReviewDashboardProps) {
  const open = blocks.filter((b) => (b.status ?? "open") === "open");
  const resolved = blocks.filter((b) => b.status === "resolved");

  // Count by type
  const typeCounts = new Map<string, number>();
  for (const b of blocks) {
    typeCounts.set(b.type, (typeCounts.get(b.type) ?? 0) + 1);
  }

  // Unanswered questions
  const unanswered = blocks.filter(
    (b) => b.type === "question" && (b.status ?? "open") === "open",
  );

  // Unresolved suggestions
  const unresolvedSuggestions = blocks.filter(
    (b) => b.type === "suggestion" && (b.status ?? "open") === "open",
  );

  // AI feedback categories
  const aiFeedback = blocks.filter((b) => b.type === "ai_feedback");
  const categoryCounts = new Map<string, number>();
  for (const b of aiFeedback) {
    const cat = String(b.metadata?.category ?? "general");
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  }

  // Authors
  const authorCounts = new Map<string, number>();
  for (const b of blocks) {
    const author = b.author ?? "unknown";
    authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
  }

  const completionPct =
    blocks.length > 0
      ? Math.round((resolved.length / blocks.length) * 100)
      : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-xl font-bold mb-1">Review Dashboard</h2>
      <p className="text-sm text-gray-500 mb-6">{filename}</p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total" value={blocks.length} />
        <StatCard label="Open" value={open.length} color="text-blue-600" />
        <StatCard
          label="Resolved"
          value={resolved.length}
          color="text-green-600"
        />
        <StatCard
          label="Completion"
          value={`${completionPct}%`}
          color={completionPct === 100 ? "text-green-600" : "text-gray-600"}
        />
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Review progress</span>
          <span>
            {resolved.length} / {blocks.length}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-green-500 h-2 rounded-full transition-all"
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* By type */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-sm text-gray-700 mb-3">By Type</h3>
          {Array.from(typeCounts.entries()).map(([type, count]) => (
            <div
              key={type}
              className="flex justify-between text-sm py-1 border-b border-gray-50 last:border-0"
            >
              <span className="text-gray-600 capitalize">{type.replace("_", " ")}</span>
              <span className="font-medium">{count}</span>
            </div>
          ))}
          {typeCounts.size === 0 && (
            <p className="text-sm text-gray-400">No comments yet</p>
          )}
        </div>

        {/* By author */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-sm text-gray-700 mb-3">
            By Author
          </h3>
          {Array.from(authorCounts.entries()).map(([author, count]) => (
            <div
              key={author}
              className="flex justify-between text-sm py-1 border-b border-gray-50 last:border-0"
            >
              <span className="text-gray-600">{author}</span>
              <span className="font-medium">{count}</span>
            </div>
          ))}
          {authorCounts.size === 0 && (
            <p className="text-sm text-gray-400">No comments yet</p>
          )}
        </div>

        {/* Attention needed */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 md:col-span-2">
          <h3 className="font-semibold text-sm text-gray-700 mb-3">
            Needs Attention
          </h3>
          {unanswered.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-medium text-purple-600 mb-1">
                Unanswered Questions ({unanswered.length})
              </h4>
              {unanswered.map((b) => (
                <div
                  key={b.id}
                  className="text-sm text-gray-700 py-1 pl-3 border-l-2 border-purple-200 mb-1"
                >
                  {b.content.slice(0, 100)}{b.content.length > 100 ? "..." : ""}
                </div>
              ))}
            </div>
          )}
          {unresolvedSuggestions.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-medium text-green-600 mb-1">
                Unresolved Suggestions ({unresolvedSuggestions.length})
              </h4>
              {unresolvedSuggestions.map((b) => (
                <div
                  key={b.id}
                  className="text-sm text-gray-700 py-1 pl-3 border-l-2 border-green-200 mb-1"
                >
                  {b.content.slice(0, 100)}{b.content.length > 100 ? "..." : ""}
                </div>
              ))}
            </div>
          )}
          {aiFeedback.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-amber-600 mb-1">
                AI Feedback Categories
              </h4>
              <div className="flex flex-wrap gap-2">
                {Array.from(categoryCounts.entries()).map(([cat, count]) => (
                  <span
                    key={cat}
                    className="px-2 py-0.5 text-xs bg-amber-50 text-amber-700 rounded-full"
                  >
                    {cat}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
          {unanswered.length === 0 &&
            unresolvedSuggestions.length === 0 &&
            aiFeedback.length === 0 && (
              <p className="text-sm text-gray-400">
                No items need attention right now.
              </p>
            )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "text-gray-900",
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
