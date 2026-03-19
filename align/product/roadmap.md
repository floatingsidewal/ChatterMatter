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

## Phase 2: Editor + Web App + P2P Collaboration

- **VS Code extension** ✅ — render ChatterMatter overlay, highlight-to-comment UX
- **Web application** ✅ — upload/link a Markdown file, non-technical reviewers comment by highlighting text, AI review with one click
- **Review dashboard** ✅ — review status across documents, unanswered questions, unresolved suggestions
- **P2P Phase 1-2** ✅ — Real-time collaborative review sessions
  - WebSocket-based star topology (owner hosts, clients connect)
  - Yjs CRDT for conflict-free sync
  - Document sharing via WebView for peers
  - Auto-reconnect on disconnect

## Phase 2b: P2P Roles & Permissions ✅

- **Role-based access control** ✅
  - Owner: full control, manage roles, delete any comment
  - Moderator: can add, resolve, and delete comments
  - Reviewer: can add and resolve comments
  - Viewer: read-only access
- **Dynamic role management** ✅ — owner can promote/demote peers
- **Cascade delete** ✅ — deleting a thread deletes all replies
- **Delete all resolved** ✅ — owner can bulk-delete resolved threads

## Phase 3: Enterprise — Review Layer for Docs-as-Code

### 3.1: P2P Session Persistence (next)
- Save/resume sessions across restarts
- Session listing and management

### 3.2: P2P Fault Tolerance
- Backup owner for failover
- Session history/audit logging

### 3.3: Enterprise Features
- Integration with docs-as-code pipelines (MkDocs, Docusaurus, mdBook, Quarto)
- Review workflows: assign reviewers, set deadlines, track approval status
- AI review of technical documents: completeness, consistency, cross-reference checking
- Enterprise features: SSO, audit logs, compliance reporting, custom AI review prompts

### 3.4: WebRTC Upgrade (future)
- NAT traversal for easier corporate connectivity
- Encrypted connections by default
- Browser-native P2P (for web app)

## Phase 4: Ecosystem

- **Obsidian plugin** — overlay experience for Obsidian users
- Python parser library
- Additional editor integrations
