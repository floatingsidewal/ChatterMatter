"use client";

import { useCallback, useState, useRef } from "react";
import { useStore } from "@/lib/store";
import { useRouter } from "next/navigation";

const DEMO_DOCUMENT = `# Project Proposal: Widget Redesign

## Summary

This proposal introduces the idea of redesigning the widget system to improve performance and user experience. The current implementation has grown organically over three years and now shows significant technical debt.

## Goals

1. Reduce initial load time by 40%
2. Improve accessibility scores to meet WCAG 2.1 AA
3. Simplify the plugin API for third-party developers
4. Add support for dark mode across all widget types

## Technical Approach

We will migrate from the legacy jQuery-based renderer to a modern React component architecture. Each widget type will become a self-contained module with its own state management.

### Phase 1: Foundation

Build the new component framework and migrate the three most-used widget types: charts, tables, and forms. This phase establishes the patterns that all subsequent migrations will follow.

### Phase 2: Migration

Systematically migrate remaining widget types. Each migration follows a strict pattern: write tests against current behavior, rebuild in React, verify test parity, deploy behind a feature flag.

### Phase 3: Cleanup

Remove the legacy renderer, update documentation, and deprecate the old plugin API with a 6-month sunset period.

## Risks

- The migration may temporarily increase bundle size as both renderers coexist
- Third-party plugins using internal APIs may break during the transition
- Team capacity is constrained by the Q3 hiring timeline

## Timeline

We estimate 4 months for the full migration, with Phase 1 deliverable in 6 weeks.
`;

export function UploadArea() {
  const { dispatch } = useStore();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteContent, setPasteContent] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const loadDocument = useCallback(
    (fileName: string, content: string) => {
      dispatch({ type: "LOAD_DOCUMENT", fileName, markdown: content });
      router.push("/review");
    },
    [dispatch, router],
  );

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith(".md") && !file.name.endsWith(".markdown") && !file.name.endsWith(".txt")) {
        alert("Please upload a Markdown file (.md, .markdown, or .txt)");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        loadDocument(file.name, content);
      };
      reader.readAsText(file);
    },
    [loadDocument],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div className="max-w-2xl mx-auto">
      {/* File upload area */}
      <div
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
          dragActive
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-gray-400 bg-white"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <div className="text-gray-400 text-4xl mb-4">&#128196;</div>
        <p className="text-gray-700 font-medium mb-1">
          Drop a Markdown file here or click to browse
        </p>
        <p className="text-gray-500 text-sm">.md, .markdown, or .txt files</p>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-4 my-6">
        <div className="flex-1 border-t border-gray-200" />
        <span className="text-gray-400 text-sm">or</span>
        <div className="flex-1 border-t border-gray-200" />
      </div>

      {/* Paste mode */}
      {pasteMode ? (
        <div>
          <textarea
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            placeholder="Paste your Markdown content here..."
            className="w-full h-64 border border-gray-300 rounded-lg p-4 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
            autoFocus
          />
          <div className="flex gap-3 mt-3">
            <button
              onClick={() => {
                if (pasteContent.trim()) {
                  loadDocument("Pasted Document.md", pasteContent);
                }
              }}
              disabled={!pasteContent.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Open in Review
            </button>
            <button
              onClick={() => { setPasteMode(false); setPasteContent(""); }}
              className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setPasteMode(true)}
          className="w-full py-3 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Paste Markdown content
        </button>
      )}

      {/* Divider */}
      <div className="flex items-center gap-4 my-6">
        <div className="flex-1 border-t border-gray-200" />
        <span className="text-gray-400 text-sm">or</span>
        <div className="flex-1 border-t border-gray-200" />
      </div>

      {/* Demo document */}
      <button
        onClick={() => loadDocument("demo-proposal.md", DEMO_DOCUMENT)}
        className="w-full py-3 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
      >
        Try with a demo document
      </button>
    </div>
  );
}
