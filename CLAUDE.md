# ChatterMatter — Development Guide

## What This Is

ChatterMatter is a structured commenting and review format for Markdown files. Comments are embedded as JSON inside fenced code blocks (` ```chattermatter `) so they travel with the document, degrade gracefully in any Markdown renderer, and survive every text pipeline.

**One-sentence pitch:** Track changes and comments for Markdown — portable, AI-native, and independent of any platform.

## Project Structure

```
ChatterMatter/
├── .claude/commands/    # Align framework — Claude Code slash commands
├── align/               # Development scaffolding (temporary, removable when done)
│   ├── product/         # Mission, roadmap, tech stack decisions
│   ├── standards/       # Coding standards for agent alignment
│   ├── features/        # Feature specifications and plans
│   └── support/         # Guides, troubleshooting, runbooks
├── docs/                # Permanent documentation
│   ├── business-case/   # Product vision, market research
│   └── spec/            # ChatterMatter format specification and review
├── src/                 # Source code (when implementation begins)
└── tests/               # Tests (when implementation begins)
```

**Key principle:** `align/` is scaffolding — essential while building, removable when done. `docs/` is permanent — what users and developers read forever.

## Align Framework

This repo uses the [Align](https://github.com/floatingsidewal/align) scaffolding framework. Available commands:

- `/align` — Main entry point. Auto-detects whether to shape new work or finalize completed work
- `/align-status` — Show current project alignment state (read-only)
- `/shape-spec` — Structured planning for new features (run in plan mode)
- `/plan-product` — Create mission, roadmap, and tech stack docs
- `/discover-standards` — Extract coding patterns from the codebase into documented standards
- `/inject-standards` — Pull relevant standards into current context
- `/index-standards` — Rebuild the standards index
- `/create-support-doc` — Generate guides, troubleshooting docs, or runbooks

## Core Format Concepts

A ChatterMatter block looks like:

````markdown
```chattermatter
{
  "id": "c1",
  "type": "comment",
  "author": "alice",
  "timestamp": "2026-02-20T10:30:00Z",
  "anchor": { "type": "text", "exact": "introduces the idea" },
  "content": "Consider strengthening this opening.",
  "status": "open"
}
```
````

Key design decisions:
- **Fenced code blocks** for embedding (visible in dumb renderers, invisible in smart ones)
- **Loss tolerance** — documents remain valid Markdown regardless of client support
- **Anchor diversity** — text quotes, headings, block index, with composite fallbacks
- **Threading** via `parent_id` references
- **Typed comments** — `comment`, `question`, `suggestion`, `ai_feedback`, `reaction`
- **Two placement modes** — inline (blocks in the `.md` file) and sidecar (blocks in a `.md.chatter` companion file)
- **Suggestions with diffs** — `suggestion` type includes `original`/`replacement` fields for machine-actionable changes
- **AI-native** — `ai_feedback` type with model/confidence/category metadata

See `docs/spec/chattermatter-spec.md` for the full format specification.
See `docs/spec/spec-review.md` for the review of the prior draft and the issues it identified (all resolved in the current spec).

## Git Commits

- Do not add co-authoring statements to commit messages
- Write concise, descriptive commit messages focused on the "why"
- Reference issue numbers when applicable

## Development Priorities

The spec review issues (see `docs/spec/spec-review.md`) have been resolved in the current spec (`docs/spec/chattermatter-spec.md`):

1. **Type enum resolved** — removed `thread` and `resolution`; defined `suggestion` with diff semantics
2. **Anchor failure defined** — orphaned blocks are preserved and displayed (§5.5)
3. **Error handling added** — duplicate IDs, circular threads, malformed JSON all specified (§12)
4. **Reactions constrained** — must be single emoji or short predefined string (§4.6)
5. **JSON specified as RFC 8259** — no JSON5 features permitted (§3.3)
6. **Round-trip preservation required** — unknown fields must be preserved on read/write (§9)

Next steps: implement the TypeScript reference parser and CLI (see `align/product/roadmap.md`).
