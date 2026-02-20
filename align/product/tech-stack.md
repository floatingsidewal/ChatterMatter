# Tech Stack

## Language

- **TypeScript** — primary language for the reference parser, CLI, and web tooling
- **Python** — secondary parser library (Phase 2+)

## Runtime

- **Node.js** — CLI and server-side execution

## Frontend

- **Next.js 15** (App Router) — web application framework, provides both React frontend and API routes
- **React 19** — component library for the web UI
- **Tailwind CSS 4** — utility-first CSS styling
- **react-markdown** + **remark-gfm** — Markdown rendering in the browser
- VS Code extension API (Phase 2) ✅
- Obsidian plugin API (Phase 4)

## Backend

- N/A for Phase 1 (CLI is local-only) ✅
- **Next.js API routes** — server-side endpoints for AI review (keeps API keys secure)

## Database

- N/A — ChatterMatter is file-native by design; no database required for core functionality

## Other

- **GitHub Actions** — CI/CD and the AI review action
- **Claude API** — AI-powered document review (`chattermatter review`)
- **npm** — package distribution
