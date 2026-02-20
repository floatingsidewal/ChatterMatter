/**
 * ChatterMatter — public API
 *
 * Track changes and comments for Markdown — portable, AI-native,
 * and independent of any platform.
 */

// Types
export type {
  Block,
  BlockType,
  BlockStatus,
  Anchor,
  TextAnchor,
  HeadingAnchor,
  BlockIndexAnchor,
  SuggestionDiff,
  ParseResult,
  ParsedBlock,
  ParseWarning,
  AnchorResolution,
  ResolvedAnchor,
  ValidationError,
  ValidationResult,
  ThreadNode,
} from "./types.js";

export { BLOCK_TYPES, BLOCK_STATUSES, REACTION_STRINGS } from "./types.js";

// Document operations (high-level API)
export type { FilterOptions } from "./document.js";
export {
  loadBlocks,
  getCleanContent,
  validate,
  listBlocks,
  buildThreads,
  addComment,
  resolveBlock,
  deleteBlock,
  resolveBlockAnchor,
} from "./document.js";

// Parser
export { parse, stripBlocks } from "./parser.js";

// Validator
export { validateBlock, validateBlocks, isValidReaction } from "./validator.js";

// Anchor resolver
export { resolveAnchor } from "./anchor.js";

// Serializer
export {
  serializeBlock,
  serializeBlocks,
  appendBlock,
  removeBlock,
  replaceBlock,
} from "./serializer.js";

// Reviewer (AI-powered document review)
export type { ReviewOptions, ReviewResult } from "./reviewer.js";
export { reviewDocument, formatReviewSummary } from "./reviewer.js";
