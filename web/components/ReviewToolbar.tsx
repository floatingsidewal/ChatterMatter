"use client";

import { useActiveDocument, useStore } from "@/lib/store";
import { getCleanContent } from "@/lib/chattermatter";
import { useState } from "react";

export function ReviewToolbar() {
  const doc = useActiveDocument();
  const { dispatch } = useStore();
  const [aiLoading, setAiLoading] = useState(false);

  if (!doc) return null;

  const openCount = doc.blocks.filter((b) => (b.status ?? "open") === "open").length;
  const resolvedCount = doc.blocks.filter((b) => b.status === "resolved").length;

  const handleDownload = () => {
    const blob = new Blob([doc.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadClean = () => {
    const clean = getCleanContent(doc.markdown);
    const blob = new Blob([clean], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.fileName.replace(/\.md$/, "-clean.md");
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAiReview = async () => {
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: doc.markdown }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`AI review failed: ${err.error ?? res.statusText}`);
        return;
      }
      const { markdown: updatedMarkdown } = await res.json();
      dispatch({ type: "UPDATE_MARKDOWN", markdown: updatedMarkdown });
    } catch (e: any) {
      alert(`AI review failed: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
      <div className="flex items-center gap-4">
        <h2 className="text-sm font-semibold text-gray-700 truncate max-w-[200px]">
          {doc.fileName}
        </h2>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{openCount} open</span>
          <span>{resolvedCount} resolved</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleAiReview}
          disabled={aiLoading}
          className="px-3 py-1.5 bg-orange-500 text-white rounded-md text-xs font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
        >
          {aiLoading ? "Reviewing..." : "AI Review"}
        </button>
        <button
          onClick={handleDownload}
          className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md text-xs font-medium hover:bg-gray-200 transition-colors"
        >
          Download
        </button>
        <button
          onClick={handleDownloadClean}
          className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md text-xs font-medium hover:bg-gray-200 transition-colors"
        >
          Download Clean
        </button>
      </div>
    </div>
  );
}
