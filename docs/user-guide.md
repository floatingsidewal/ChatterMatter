# ChatterMatter User Guide

Track changes and comments for Markdown — portable, AI-native, and independent of any platform.

## What Is ChatterMatter?

ChatterMatter is a format for embedding comments, suggestions, questions, and review feedback directly inside Markdown files. Comments are stored as JSON in fenced code blocks (```` ```chattermatter ````), which means they:

- **Travel with the file.** No external database, no platform lock-in. Move the file anywhere and the comments follow.
- **Degrade gracefully.** In renderers that don't understand ChatterMatter, comments appear as inert code blocks. The document remains valid Markdown.
- **Survive every pipeline.** Anything that preserves fenced code blocks preserves your comments.
- **Preserve decision history.** Resolved comments stay in the file as an audit trail, capturing *why* a document became what it is.

ChatterMatter works without any special tooling. You can write comments by hand in any text editor. Dedicated tools and integrations enhance the experience but are never required.

---

## Quick Start

### Adding your first comment

Open any Markdown file and insert a ChatterMatter block:

````markdown
# My Document

This paragraph introduces the idea behind our new approach.

```chattermatter
{
  "id": "c1",
  "type": "comment",
  "author": "alice",
  "timestamp": "2026-02-20T10:30:00Z",
  "anchor": { "type": "text", "exact": "introduces the idea" },
  "content": "Consider strengthening this opening. 'Introduces the idea' is vague.",
  "status": "open"
}
```

The rest of the document continues normally.
````

That's it. The comment is now part of the file. Anyone who opens the file sees the comment — either rendered in a ChatterMatter-aware tool or as a code block in a plain Markdown viewer.

### Replying to a comment

Add another block with a `thread` field that references the parent comment's `id`:

````markdown
```chattermatter
{
  "id": "c2",
  "type": "comment",
  "author": "bob",
  "timestamp": "2026-02-20T11:15:00Z",
  "thread": "c1",
  "content": "Agreed. How about 'establishes the foundation'?",
  "status": "open"
}
```
````

### Resolving a comment

Update the `status` field to `"resolved"`:

````markdown
```chattermatter
{
  "id": "c1",
  "type": "comment",
  "author": "alice",
  "timestamp": "2026-02-20T10:30:00Z",
  "anchor": { "type": "text", "exact": "introduces the idea" },
  "content": "Consider strengthening this opening. 'Introduces the idea' is vague.",
  "status": "resolved"
}
```
````

---

## Comment Structure

Every ChatterMatter block is a fenced code block with the language tag `chattermatter`, containing a single JSON object. Here is the full anatomy:

```json
{
  "id": "c1",
  "spec_version": "0.1",
  "type": "comment",
  "author": "alice",
  "timestamp": "2026-02-20T10:30:00Z",
  "anchor": {
    "type": "text",
    "exact": "the specific text this comment is about",
    "context_before": "preceding text for disambiguation",
    "context_after": "following text for disambiguation"
  },
  "content": "The body of the comment.",
  "thread": "c0",
  "status": "open",
  "metadata": {}
}
```

### Required fields

| Field | Description |
|-------|-------------|
| `id` | Unique identifier for this comment. Use a UUID to avoid collisions in multi-author scenarios. |
| `type` | The kind of feedback. See [Comment Types](#comment-types). |
| `author` | Who wrote the comment (username, name, or identifier). |
| `content` | The body of the comment. |

### Optional fields

| Field | Description |
|-------|-------------|
| `spec_version` | ChatterMatter format version (e.g., `"0.1"`). |
| `timestamp` | ISO 8601 datetime (e.g., `"2026-02-20T10:30:00Z"`). |
| `anchor` | What part of the document this comment refers to. See [Anchoring Comments](#anchoring-comments). |
| `thread` | The `id` of the parent comment, for threading replies. |
| `status` | `"open"` or `"resolved"`. Defaults to `"open"` if omitted. |
| `metadata` | Open object for tool-specific or workflow-specific data. |

### JSON format

ChatterMatter blocks must contain valid JSON per [RFC 8259](https://tools.ietf.org/html/rfc8259). JSON5 features (comments, trailing commas, unquoted keys) are not permitted.

---

## Comment Types

The `type` field indicates the intent behind a comment. This matters because different types serve different purposes in a review workflow — tools can filter, route, and track them accordingly.

### `comment`

General feedback or observation. Use this for anything that doesn't fit a more specific type.

````markdown
```chattermatter
{
  "id": "c1",
  "type": "comment",
  "author": "alice",
  "content": "This section feels too long. Consider splitting it into two parts.",
  "anchor": { "type": "heading", "exact": "Architecture Overview" },
  "status": "open"
}
```
````

### `question`

A request for clarification. Questions signal that the reviewer needs a response before the document can move forward.

````markdown
```chattermatter
{
  "id": "c2",
  "type": "question",
  "author": "bob",
  "content": "Is this cost estimate based on the Q3 projections or the revised Q4 numbers?",
  "anchor": { "type": "text", "exact": "estimated cost of $2.4M" },
  "status": "open"
}
```
````

### `suggestion`

A proposed edit to the text. When a suggestion includes structured replacement data, tools can offer "accept/reject" functionality.

````markdown
```chattermatter
{
  "id": "c3",
  "type": "suggestion",
  "author": "carol",
  "anchor": { "type": "text", "exact": "introduces the idea" },
  "content": "Stronger phrasing would improve the opening.",
  "suggestion": {
    "original": "introduces the idea",
    "replacement": "establishes the foundation"
  },
  "status": "open"
}
```
````

The `suggestion` object with `original` and `replacement` fields enables tools to show a diff and offer one-click acceptance.

### `ai_feedback`

Feedback generated by an AI reviewer. This type lets tools visually distinguish human and AI comments, and lets readers filter AI feedback separately.

````markdown
```chattermatter
{
  "id": "c4",
  "type": "ai_feedback",
  "author": "claude",
  "timestamp": "2026-02-20T14:00:00Z",
  "anchor": { "type": "text", "exact": "the system processes requests in real-time" },
  "content": "This claim should be qualified. The architecture described earlier uses a message queue, which introduces latency. Consider 'near real-time' or defining what 'real-time' means in this context.",
  "status": "open"
}
```
````

### `reaction`

A lightweight response — typically an emoji or short acknowledgment. Reactions are useful for signaling agreement, approval, or other quick feedback without adding a full comment.

````markdown
```chattermatter
{
  "id": "c5",
  "type": "reaction",
  "author": "dave",
  "thread": "c3",
  "content": "+1"
}
```
````

---

## Anchoring Comments

Anchors attach a comment to a specific location in the document. Without an anchor, a comment applies to the document as a whole. ChatterMatter supports several anchor types, listed here in order of preference.

### Text anchor (preferred)

Matches an exact substring in the document. This is the most resilient anchor type because it survives edits that don't touch the quoted text.

```json
{
  "anchor": {
    "type": "text",
    "exact": "estimated cost of $2.4M"
  }
}
```

When the same text appears multiple times in a document, use `context_before` and `context_after` to disambiguate:

```json
{
  "anchor": {
    "type": "text",
    "exact": "the system",
    "context_before": "As described in the architecture section,",
    "context_after": "processes incoming requests"
  }
}
```

### Heading anchor

References a section by its heading text. Useful for comments that apply to an entire section rather than specific text within it.

```json
{
  "anchor": {
    "type": "heading",
    "exact": "Architecture Overview"
  }
}
```

### Block index anchor

References a Markdown block by its position (zero-indexed). A "block" is a top-level Markdown element: paragraph, heading, list, code block, table, etc.

```json
{
  "anchor": {
    "type": "block_index",
    "index": 3
  }
}
```

Block index anchors are fragile — any insertion or deletion of blocks above the target shifts the index. Use them as a fallback or in combination with other anchor types when text matching isn't possible.

### No anchor (document-level)

Omitting the `anchor` field means the comment applies to the document as a whole:

````markdown
```chattermatter
{
  "id": "c10",
  "type": "comment",
  "author": "alice",
  "content": "Overall this draft is well-structured. Ready for stakeholder review after the open questions are resolved.",
  "status": "open"
}
```
````

---

## Threading Conversations

Comments form threads through the `thread` field, which references the `id` of a parent comment. Any comment without a `thread` field is a top-level (root) comment.

### Example: a threaded discussion

````markdown
```chattermatter
{
  "id": "c1",
  "type": "question",
  "author": "alice",
  "anchor": { "type": "text", "exact": "deploy to production weekly" },
  "content": "Is weekly frequent enough? The SRE team has been pushing for continuous deployment.",
  "status": "open"
}
```

```chattermatter
{
  "id": "c2",
  "type": "comment",
  "author": "bob",
  "thread": "c1",
  "content": "Weekly is a compromise. We don't have the test coverage for continuous deployment yet.",
  "status": "open"
}
```

```chattermatter
{
  "id": "c3",
  "type": "comment",
  "author": "alice",
  "thread": "c1",
  "content": "Fair point. Let's add a note about moving to CD once coverage hits 80%.",
  "status": "open"
}
```

```chattermatter
{
  "id": "c4",
  "type": "suggestion",
  "author": "alice",
  "thread": "c1",
  "anchor": { "type": "text", "exact": "deploy to production weekly" },
  "content": "Updated to reflect the CD roadmap.",
  "suggestion": {
    "original": "deploy to production weekly",
    "replacement": "deploy to production weekly, moving to continuous deployment once test coverage exceeds 80%"
  },
  "status": "open"
}
```
````

### Threading rules

- Set `thread` to the `id` of the comment you're replying to.
- Threads can be nested — a reply can itself have replies.
- All comments in a thread share the conversation namespace of a single document. Cross-document thread references are not supported.
- The position of comment blocks in the file does not determine thread structure. Display ordering should derive from timestamps and thread relationships.

---

## Status and Resolution

The `status` field tracks whether a comment needs attention.

| Status | Meaning |
|--------|---------|
| `"open"` | The comment is active and needs attention. This is the default. |
| `"resolved"` | The comment has been addressed. It remains in the file as part of the decision history. |

### Resolving a comment

Change `status` from `"open"` to `"resolved"`. Resolved comments remain in the file — they serve as an audit trail documenting why the document evolved the way it did.

### Removing comments

To fully remove a comment, delete the entire fenced code block from the file. This is appropriate for comments that have no historical value (e.g., typo fixes after the typo is corrected).

### Preserving decision history

One of ChatterMatter's key strengths is capturing *why* a document became what it is. A resolved thread documenting a debate over architectural choices is more valuable than the final text alone. Consider keeping resolved comments rather than deleting them.

---

## The Sidecar Pattern

For workflows where you want the document itself to stay clean, ChatterMatter supports a sidecar file pattern: keep the document free of comment blocks and store all comments in a companion file.

### Convention

For a document named `proposal.md`, the sidecar file is `proposal.md.chatter`:

```
project/
├── proposal.md           # Clean document, no comment blocks
└── proposal.md.chatter   # All ChatterMatter blocks for proposal.md
```

The sidecar file contains ChatterMatter blocks exactly as they would appear inline, one after another:

````markdown
```chattermatter
{
  "id": "c1",
  "type": "comment",
  "author": "alice",
  "anchor": { "type": "heading", "exact": "Budget" },
  "content": "These numbers need to be updated for Q2.",
  "status": "open"
}
```

```chattermatter
{
  "id": "c2",
  "type": "question",
  "author": "bob",
  "anchor": { "type": "text", "exact": "estimated timeline of six months" },
  "content": "Does this account for the hiring delay?",
  "status": "open"
}
```
````

### When to use the sidecar pattern

- **Access control.** Keep internal deliberation private while sharing the clean document publicly.
- **Diffability.** The document itself produces clean diffs in version control. Comment churn is isolated to the sidecar file.
- **Opt-in complexity.** Collaborators who don't use ChatterMatter see only a normal Markdown file.

### When to use inline comments

- **Portability.** A single file with embedded comments is simpler to share than a file pair.
- **Context.** Comments next to the text they reference are easier to follow when reading the raw Markdown.

Both approaches can coexist in a team — some documents may use inline comments while others use sidecar files.

---

## Working with AI Review

ChatterMatter is designed as a natural output format for AI document reviewers. An AI tool can read a Markdown document and produce ChatterMatter blocks as structured feedback.

### Example workflow

1. Write or update a Markdown document.
2. Run an AI reviewer that outputs ChatterMatter blocks.
3. The AI's feedback appears as `ai_feedback` type comments anchored to specific parts of the document.
4. Review the AI feedback, respond via threaded comments, and resolve as appropriate.

### Example AI-generated feedback

````markdown
```chattermatter
{
  "id": "ai-1",
  "type": "ai_feedback",
  "author": "claude",
  "timestamp": "2026-02-20T14:00:00Z",
  "anchor": { "type": "text", "exact": "This will reduce costs by 40%" },
  "content": "This claim lacks a citation or methodology. Consider adding a reference to the cost analysis in Appendix B, or qualifying the estimate with 'based on Q3 projections'.",
  "status": "open"
}
```

```chattermatter
{
  "id": "ai-2",
  "type": "ai_feedback",
  "author": "claude",
  "timestamp": "2026-02-20T14:00:01Z",
  "anchor": { "type": "heading", "exact": "Security Considerations" },
  "content": "This section covers authentication and authorization but does not address data encryption at rest or in transit. Consider adding a subsection on encryption requirements.",
  "status": "open"
}
```
````

The `ai_feedback` type lets tools and readers distinguish AI-generated comments from human comments, enabling filtering and separate rendering when desired.

---

## Working with Git

ChatterMatter works without Git, but Git integration adds version history and collaboration capabilities.

### Basic workflow

1. Add comments to a Markdown file (inline or sidecar).
2. Commit the file with its comments.
3. Push and share. Collaborators pull, add their own comments, and push back.

### Review workflow with branches

1. Create a branch for review: `git checkout -b review/alice`.
2. Add ChatterMatter comments to the documents under review.
3. Open a pull request. The diff shows exactly which comments were added.
4. The author responds with threaded comments and resolves feedback.
5. Merge when review is complete. The comment history is preserved in the main branch.

### Tips for Git workflows

- **Sidecar files produce cleaner diffs.** Document edits and comment activity appear in separate files, making PRs easier to review.
- **Commit messages can reference comment IDs.** For example: `"Address feedback c3: clarify deployment timeline"`.
- **Resolved comments are documentation.** Resist the urge to delete them before merging — they capture the reasoning behind changes.

---

## Best Practices

### Writing effective comments

- **Be specific.** Anchor comments to the exact text you're referring to rather than leaving document-level comments when a specific location is relevant.
- **Use the right type.** A `question` signals that you need a response. A `suggestion` signals that you have a concrete alternative. A `comment` is for everything else. The type helps the author prioritize.
- **Thread replies.** Always use the `thread` field when responding to an existing comment rather than creating a new top-level comment. This keeps conversations together.

### Managing comment lifecycle

- **Resolve, don't delete.** Change `status` to `"resolved"` when feedback has been addressed. The comment stays as documentation of why the change was made.
- **Delete only noise.** Remove comments entirely only when they have no historical value — typo corrections, formatting fixes, or test comments.
- **Review open comments before finalizing.** Before marking a document as complete, check that all `"status": "open"` comments have been addressed.

### IDs

- **Use UUIDs** in multi-author scenarios to avoid collisions. Two authors independently creating `"id": "c1"` will cause conflicts.
- **Simple IDs are fine for single-author use.** When you're the only commenter, `c1`, `c2`, `c3` is readable and sufficient.

### Metadata

The `metadata` field is an open object for workflow-specific data. Examples:

```json
{
  "metadata": {
    "priority": "high",
    "category": "legal-review",
    "due_date": "2026-03-01"
  }
}
```

Tools should preserve unknown metadata fields when reading and rewriting a document to avoid data loss.

---

## Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier. UUID recommended for multi-author use. |
| `spec_version` | string | No | Format version (e.g., `"0.1"`). |
| `type` | string | Yes | One of: `comment`, `question`, `suggestion`, `ai_feedback`, `reaction`. |
| `author` | string | Yes | Who wrote the comment. |
| `timestamp` | string | No | ISO 8601 datetime (e.g., `"2026-02-20T10:30:00Z"`). |
| `anchor` | object | No | Location in the document this comment refers to. Omit for document-level comments. |
| `anchor.type` | string | Yes* | Anchor type: `text`, `heading`, or `block_index`. *Required if `anchor` is present. |
| `anchor.exact` | string | Yes* | The text to match. *Required for `text` and `heading` anchors. |
| `anchor.context_before` | string | No | Text before `exact` for disambiguation. Only for `text` anchors. |
| `anchor.context_after` | string | No | Text after `exact` for disambiguation. Only for `text` anchors. |
| `anchor.index` | number | Yes* | Zero-based block position. *Required for `block_index` anchors. |
| `content` | string | Yes | The body of the comment. |
| `thread` | string | No | The `id` of the parent comment for threading. |
| `suggestion` | object | No | Replacement data for `suggestion` type comments. |
| `suggestion.original` | string | Yes* | The text to be replaced. *Required if `suggestion` is present. |
| `suggestion.replacement` | string | Yes* | The replacement text. *Required if `suggestion` is present. |
| `status` | string | No | `"open"` (default) or `"resolved"`. |
| `metadata` | object | No | Open object for tool-specific or workflow-specific data. |
