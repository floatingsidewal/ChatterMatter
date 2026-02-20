"use client";

import { useState, useCallback, useEffect } from "react";
import FileUpload from "@/components/FileUpload";
import MarkdownViewer from "@/components/MarkdownViewer";
import CommentSidebar from "@/components/CommentSidebar";
import CommentForm from "@/components/CommentForm";
import Toolbar from "@/components/Toolbar";
import ReviewDashboard from "@/components/ReviewDashboard";
import type { CommentBlock, ParsedDocument } from "@/lib/store";

export default function Home() {
  // Document state
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [parsed, setParsed] = useState<ParsedDocument | null>(null);

  // UI state
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);

  // Parse markdown whenever it changes
  const parseDocument = useCallback(async (md: string) => {
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "parse", markdown: md }),
      });
      const data = await res.json();
      if (data.error) {
        console.error("Parse error:", data.error);
        return;
      }
      setParsed({
        cleanContent: data.cleanContent,
        blocks: data.blocks,
        warnings: data.warnings,
      });
    } catch (err) {
      console.error("Parse failed:", err);
    }
  }, []);

  // Re-parse whenever markdown changes
  useEffect(() => {
    if (markdown) {
      parseDocument(markdown);
    }
  }, [markdown, parseDocument]);

  // Listen for highlight clicks from the DOM
  useEffect(() => {
    const handler = (e: Event) => {
      const blockId = (e as CustomEvent).detail;
      setActiveBlockId(blockId);
    };
    document.addEventListener("chattermatter:block-click", handler);
    return () =>
      document.removeEventListener("chattermatter:block-click", handler);
  }, []);

  const handleFileLoaded = useCallback(
    (content: string, name: string) => {
      setMarkdown(content);
      setFilename(name);
      setShowDashboard(false);
      setActiveBlockId(null);
      setSelectedText("");
    },
    [],
  );

  const handleAddComment = useCallback(
    async (data: {
      content: string;
      type: string;
      author: string;
      anchor: { type: "text"; exact: string } | null;
    }) => {
      if (!markdown) return;
      try {
        const res = await fetch("/api/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add",
            markdown,
            content: data.content,
            type: data.type,
            author: data.author,
            anchor: data.anchor,
          }),
        });
        const result = await res.json();
        if (result.error) {
          alert(result.error);
          return;
        }
        setMarkdown(result.markdown);
        setShowCommentForm(false);
        setSelectedText("");
        setActiveBlockId(result.block.id);
      } catch (err) {
        console.error("Add comment failed:", err);
      }
    },
    [markdown],
  );

  const handleResolve = useCallback(
    async (blockId: string) => {
      if (!markdown) return;
      try {
        const res = await fetch("/api/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resolve", markdown, blockId }),
        });
        const result = await res.json();
        if (result.error) {
          alert(result.error);
          return;
        }
        setMarkdown(result.markdown);
      } catch (err) {
        console.error("Resolve failed:", err);
      }
    },
    [markdown],
  );

  const handleDelete = useCallback(
    async (blockId: string) => {
      if (!markdown) return;
      try {
        const res = await fetch("/api/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", markdown, blockId }),
        });
        const result = await res.json();
        if (result.error) {
          alert(result.error);
          return;
        }
        setMarkdown(result.markdown);
        if (activeBlockId === blockId) setActiveBlockId(null);
      } catch (err) {
        console.error("Delete failed:", err);
      }
    },
    [markdown, activeBlockId],
  );

  const handleReply = useCallback(
    async (parentId: string, content: string) => {
      if (!markdown) return;
      try {
        const res = await fetch("/api/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add",
            markdown,
            content,
            type: "comment",
            author: "reviewer",
            parent_id: parentId,
          }),
        });
        const result = await res.json();
        if (result.error) {
          alert(result.error);
          return;
        }
        setMarkdown(result.markdown);
      } catch (err) {
        console.error("Reply failed:", err);
      }
    },
    [markdown],
  );

  const handleAIReview = useCallback(async () => {
    if (!markdown) return;
    setIsReviewing(true);
    setReviewError(null);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown }),
      });
      const result = await res.json();
      if (result.error) {
        setReviewError(result.error);
        return;
      }
      setMarkdown(result.markdown);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setIsReviewing(false);
    }
  }, [markdown]);

  const handleDownload = useCallback(() => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "document.md";
    a.click();
    URL.revokeObjectURL(url);
  }, [markdown, filename]);

  // No file loaded — show upload
  if (!markdown || !parsed) {
    return (
      <main className="min-h-screen p-8">
        <FileUpload onFileLoaded={handleFileLoaded} />
      </main>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <Toolbar
        filename={filename}
        selectedText={selectedText}
        onAddComment={() => setShowCommentForm(true)}
        onAIReview={handleAIReview}
        onDownload={handleDownload}
        onReset={() => {
          setMarkdown(null);
          setParsed(null);
          setFilename("");
        }}
        isReviewing={isReviewing}
        showDashboard={showDashboard}
        onToggleDashboard={() => setShowDashboard(!showDashboard)}
      />

      {reviewError && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700 flex items-center justify-between">
          <span>{reviewError}</span>
          <button
            onClick={() => setReviewError(null)}
            className="text-red-400 hover:text-red-600"
          >
            Dismiss
          </button>
        </div>
      )}

      {showDashboard ? (
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <ReviewDashboard blocks={parsed.blocks} filename={filename} />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Main content area */}
          <div className="flex-1 overflow-y-auto bg-white">
            <MarkdownViewer
              content={parsed.cleanContent}
              blocks={parsed.blocks}
              activeBlockId={activeBlockId}
              onBlockClick={setActiveBlockId}
              onTextSelected={setSelectedText}
            />
          </div>

          {/* Sidebar */}
          <div className="w-80 border-l border-gray-200 bg-white overflow-hidden flex flex-col">
            <CommentSidebar
              blocks={parsed.blocks}
              activeBlockId={activeBlockId}
              onBlockClick={setActiveBlockId}
              onResolve={handleResolve}
              onDelete={handleDelete}
              onReply={handleReply}
            />
          </div>
        </div>
      )}

      {/* Comment form modal */}
      {showCommentForm && (
        <CommentForm
          selectedText={selectedText}
          onSubmit={handleAddComment}
          onCancel={() => {
            setShowCommentForm(false);
            setSelectedText("");
          }}
        />
      )}
    </div>
  );
}
