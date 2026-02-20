/**
 * ChatterMatter v0.1 — TypeScript type definitions
 *
 * These types model the ChatterMatter block schema as defined in the spec.
 */

// ---------------------------------------------------------------------------
// Type enum (§4.3)
// ---------------------------------------------------------------------------

export const BLOCK_TYPES = [
  "comment",
  "question",
  "suggestion",
  "ai_feedback",
  "reaction",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

// ---------------------------------------------------------------------------
// Status (§4.2)
// ---------------------------------------------------------------------------

export const BLOCK_STATUSES = ["open", "resolved"] as const;
export type BlockStatus = (typeof BLOCK_STATUSES)[number];

// ---------------------------------------------------------------------------
// Anchors (§5)
// ---------------------------------------------------------------------------

export interface TextAnchor {
  type: "text";
  exact: string;
  context_before?: string;
  context_after?: string;
  fallback?: Anchor;
}

export interface HeadingAnchor {
  type: "heading";
  text: string;
  level?: number;
  fallback?: Anchor;
}

export interface BlockIndexAnchor {
  type: "block_index";
  index: number;
  fallback?: Anchor;
}

export type Anchor = TextAnchor | HeadingAnchor | BlockIndexAnchor;

// ---------------------------------------------------------------------------
// Suggestion diff (§4.4)
// ---------------------------------------------------------------------------

export interface SuggestionDiff {
  original: string;
  replacement: string;
}

// ---------------------------------------------------------------------------
// Block (§4)
// ---------------------------------------------------------------------------

/** Required fields present on every valid block. */
export interface BlockRequired {
  id: string;
  type: string; // Kept as string (not BlockType) so unknown types are preserved per §12
  content: string;
}

/** The full block shape including optional fields. */
export interface Block extends BlockRequired {
  author?: string;
  timestamp?: string;
  anchor?: Anchor;
  parent_id?: string | null;
  status?: BlockStatus;
  suggestion?: SuggestionDiff;
  metadata?: Record<string, unknown>;
  spec_version?: string;
  /** Round-trip: any unknown fields from the original JSON are kept here. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Reaction predefined strings (§4.6)
// ---------------------------------------------------------------------------

export const REACTION_STRINGS = ["+1", "-1", "agree", "disagree"] as const;

// ---------------------------------------------------------------------------
// Parse result types
// ---------------------------------------------------------------------------

export interface ParseWarning {
  message: string;
  /** The raw source text of the block that caused the warning, if available. */
  source?: string;
}

export interface ParsedBlock {
  block: Block;
  /** Zero-based index of the fenced code block in document order. */
  documentIndex: number;
  /** The start offset (character position) in the source markdown. */
  startOffset: number;
  /** The end offset (character position) in the source markdown. */
  endOffset: number;
}

export interface ParseResult {
  blocks: ParsedBlock[];
  warnings: ParseWarning[];
}

// ---------------------------------------------------------------------------
// Anchor resolution
// ---------------------------------------------------------------------------

export interface ResolvedAnchor {
  /** Character offset where the anchored text starts in the document. */
  offset: number;
  /** Length of the matched text. */
  length: number;
  /** Whether this was resolved via a fallback anchor. */
  usedFallback: boolean;
}

export type AnchorResolution =
  | { resolved: true; result: ResolvedAnchor }
  | { resolved: false };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  blockId: string;
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ---------------------------------------------------------------------------
// Thread tree (§6)
// ---------------------------------------------------------------------------

export interface ThreadNode {
  block: Block;
  children: ThreadNode[];
}
