"use client";

import { useCallback, useRef, useState } from "react";

interface FileUploadProps {
  onFileLoaded: (content: string, filename: string) => void;
}

export default function FileUpload({ onFileLoaded }: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith(".md") && !file.name.endsWith(".markdown")) {
        alert("Please upload a Markdown file (.md or .markdown)");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        onFileLoaded(text, file.name);
      };
      reader.readAsText(file);
    },
    [onFileLoaded],
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files?.[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    },
    [handleFile],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) {
        handleFile(e.target.files[0]);
      }
    },
    [handleFile],
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="max-w-lg w-full text-center">
        <h1 className="text-3xl font-bold mb-2">ChatterMatter</h1>
        <p className="text-gray-500 mb-8">
          Upload a Markdown file to review, comment, and collaborate.
        </p>

        <div
          className={`border-2 border-dashed rounded-xl p-12 transition-colors cursor-pointer ${
            dragActive
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 hover:border-gray-400"
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <div className="text-gray-400 mb-4">
            <svg
              className="mx-auto h-12 w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <p className="text-sm text-gray-600">
            <span className="font-medium text-blue-600">Click to upload</span>{" "}
            or drag and drop
          </p>
          <p className="text-xs text-gray-400 mt-1">.md or .markdown files</p>
          <input
            ref={inputRef}
            type="file"
            accept=".md,.markdown"
            onChange={handleChange}
            className="hidden"
          />
        </div>

        <div className="mt-6">
          <button
            onClick={() => {
              const demo = `# Welcome to ChatterMatter

This is a sample document for reviewing. ChatterMatter lets you add structured comments to Markdown files.

## Key Features

ChatterMatter comments are embedded as JSON in fenced code blocks. They travel with the document, degrade gracefully, and survive every text pipeline.

### Highlight to Comment

Select any text in this document and click "Add Comment" to create a new comment anchored to that text.

### AI Review

Click the "AI Review" button to get AI-powered feedback on this document. The AI will analyze clarity, completeness, consistency, accuracy, and structure.

## Example Section

This section demonstrates how comments anchor to text. Try highlighting "demonstrates how comments" and adding a comment.

> "The best documentation is the kind that explains itself." — Every developer who has ever written docs

## Conclusion

ChatterMatter makes document review portable and independent of any platform. Comments are just data — structured, queryable, and always available.
`;
              onFileLoaded(demo, "sample.md");
            }}
            className="text-sm text-gray-400 hover:text-gray-600 underline"
          >
            or try a sample document
          </button>
        </div>
      </div>
    </div>
  );
}
