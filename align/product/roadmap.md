# Product Roadmap

## Phase 1: MVP — Format + CLI (Open Source Foundation) ✅

- **ChatterMatter specification v0.1** — the format definition (inline and sidecar modes)
- **Reference parser library** (TypeScript) — parse, validate, and manipulate ChatterMatter blocks
- **CLI tool** — `chattermatter add`, `list`, `resolve`, `strip`, `review`
  - `add` — add a comment anchored to document text
  - `list` — show all comments, filterable by type/status/author
  - `resolve` — mark a comment as resolved
  - `strip` — produce a clean Markdown file with all ChatterMatter blocks removed
  - `review` — AI-powered document review that produces ChatterMatter blocks
- **GitHub Action** — AI reviews `.md` files in PRs and writes ChatterMatter blocks

## Phase 2: Editor + Web App

- **VS Code extension** ✅ — render ChatterMatter overlay, highlight-to-comment UX
- **Web application** ✅ — upload/link a Markdown file, non-technical reviewers comment by highlighting text, AI review with one click
- **Review dashboard** ✅ — review status across documents, unanswered questions, unresolved suggestions

## Phase 3: Enterprise — Review Layer for Docs-as-Code

- Integration with docs-as-code pipelines (MkDocs, Docusaurus, mdBook, Quarto)
- Review workflows: assign reviewers, set deadlines, track approval status
- AI review of technical documents: completeness, consistency, cross-reference checking
- Enterprise features: SSO, audit logs, compliance reporting, custom AI review prompts

## Phase 4: Ecosystem

- **Obsidian plugin** — overlay experience for Obsidian users
- Python parser library
- Additional editor integrations
