/**
 * Client-side state for the ChatterMatter web app.
 *
 * Documents are held in memory — no database needed.
 */

export interface DocumentState {
  /** Original Markdown source (with ChatterMatter blocks). */
  raw: string;
  /** Filename from the upload. */
  filename: string;
}

export interface CommentBlock {
  id: string;
  type: string;
  content: string;
  author?: string;
  timestamp?: string;
  status?: string;
  parent_id?: string | null;
  anchor?: {
    type: string;
    exact?: string;
    text?: string;
    level?: number;
    index?: number;
  };
  suggestion?: { original: string; replacement: string };
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ParsedDocument {
  cleanContent: string;
  blocks: CommentBlock[];
  warnings: string[];
}
