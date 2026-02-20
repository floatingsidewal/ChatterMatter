"use client";

import { useStore, type DocumentEntry } from "@/lib/store";
import Link from "next/link";

export default function DashboardPage() {
  const { state, dispatch } = useStore();
  const { documents } = state;

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-56px)] text-gray-500">
        <p className="mb-4">No documents loaded yet.</p>
        <Link
          href="/"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Upload a document
        </Link>
      </div>
    );
  }

  // Aggregate stats across all documents
  const totalBlocks = documents.reduce((n, d) => n + d.blocks.length, 0);
  const totalOpen = documents.reduce(
    (n, d) => n + d.blocks.filter((b) => (b.status ?? "open") === "open").length,
    0,
  );
  const totalResolved = documents.reduce(
    (n, d) => n + d.blocks.filter((b) => b.status === "resolved").length,
    0,
  );
  const totalQuestions = documents.reduce(
    (n, d) => n + d.blocks.filter((b) => b.type === "question" && (b.status ?? "open") === "open").length,
    0,
  );
  const totalSuggestions = documents.reduce(
    (n, d) => n + d.blocks.filter((b) => b.type === "suggestion" && (b.status ?? "open") === "open").length,
    0,
  );
  const totalAiFeedback = documents.reduce(
    (n, d) => n + d.blocks.filter((b) => b.type === "ai_feedback" && (b.status ?? "open") === "open").length,
    0,
  );

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Review Dashboard</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label="Total Comments" value={totalBlocks} />
        <StatCard label="Open" value={totalOpen} color="text-orange-600" />
        <StatCard label="Resolved" value={totalResolved} color="text-green-600" />
        <StatCard label="Questions" value={totalQuestions} color="text-purple-600" />
        <StatCard label="Suggestions" value={totalSuggestions} color="text-blue-600" />
        <StatCard label="AI Feedback" value={totalAiFeedback} color="text-orange-500" />
      </div>

      {/* Documents table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3">Document</th>
              <th className="px-4 py-3 text-center">Open</th>
              <th className="px-4 py-3 text-center">Resolved</th>
              <th className="px-4 py-3 text-center">Questions</th>
              <th className="px-4 py-3 text-center">Suggestions</th>
              <th className="px-4 py-3 text-center">AI</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                isActive={doc.id === state.activeDocumentId}
                onActivate={() => dispatch({ type: "SET_ACTIVE", id: doc.id })}
                onRemove={() => dispatch({ type: "REMOVE_DOCUMENT", id: doc.id })}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Unanswered questions */}
      {totalQuestions > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Unanswered Questions ({totalQuestions})
          </h2>
          <div className="space-y-3">
            {documents.flatMap((doc) =>
              doc.blocks
                .filter((b) => b.type === "question" && (b.status ?? "open") === "open")
                .map((block) => (
                  <div
                    key={block.id}
                    className="bg-white border border-purple-200 rounded-lg p-4"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                        Question
                      </span>
                      <span className="text-xs text-gray-400">{doc.fileName}</span>
                      {block.author && (
                        <span className="text-xs text-gray-500">{block.author}</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700">{block.content}</p>
                    {block.anchor?.type === "text" && (
                      <p className="text-xs text-gray-400 mt-1 truncate">
                        &ldquo;{block.anchor.exact}&rdquo;
                      </p>
                    )}
                  </div>
                )),
            )}
          </div>
        </div>
      )}

      {/* Unresolved suggestions */}
      {totalSuggestions > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Unresolved Suggestions ({totalSuggestions})
          </h2>
          <div className="space-y-3">
            {documents.flatMap((doc) =>
              doc.blocks
                .filter((b) => b.type === "suggestion" && (b.status ?? "open") === "open")
                .map((block) => (
                  <div
                    key={block.id}
                    className="bg-white border border-green-200 rounded-lg p-4"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
                        Suggestion
                      </span>
                      <span className="text-xs text-gray-400">{doc.fileName}</span>
                      {block.author && (
                        <span className="text-xs text-gray-500">{block.author}</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700">{block.content}</p>
                    {block.suggestion && (
                      <div className="mt-2 text-xs rounded overflow-hidden border border-gray-200">
                        <div className="bg-red-50 text-red-800 px-2 py-1 line-through">
                          {block.suggestion.original}
                        </div>
                        <div className="bg-green-50 text-green-800 px-2 py-1">
                          {block.suggestion.replacement}
                        </div>
                      </div>
                    )}
                  </div>
                )),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "text-gray-900",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function DocumentRow({
  doc,
  isActive,
  onActivate,
  onRemove,
}: {
  doc: DocumentEntry;
  isActive: boolean;
  onActivate: () => void;
  onRemove: () => void;
}) {
  const open = doc.blocks.filter((b) => (b.status ?? "open") === "open").length;
  const resolved = doc.blocks.filter((b) => b.status === "resolved").length;
  const questions = doc.blocks.filter((b) => b.type === "question" && (b.status ?? "open") === "open").length;
  const suggestions = doc.blocks.filter((b) => b.type === "suggestion" && (b.status ?? "open") === "open").length;
  const ai = doc.blocks.filter((b) => b.type === "ai_feedback" && (b.status ?? "open") === "open").length;

  return (
    <tr className={isActive ? "bg-blue-50" : "hover:bg-gray-50"}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800">{doc.fileName}</span>
          {isActive && (
            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
              Active
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-center text-sm text-orange-600 font-medium">{open}</td>
      <td className="px-4 py-3 text-center text-sm text-green-600 font-medium">{resolved}</td>
      <td className="px-4 py-3 text-center text-sm text-purple-600">{questions}</td>
      <td className="px-4 py-3 text-center text-sm text-blue-600">{suggestions}</td>
      <td className="px-4 py-3 text-center text-sm text-orange-500">{ai}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <Link
            href="/review"
            onClick={onActivate}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Review
          </Link>
          <button
            onClick={onRemove}
            className="text-xs text-red-500 hover:text-red-700"
          >
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}
