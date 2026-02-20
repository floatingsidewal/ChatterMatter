# Tech Stack

## Language

- **TypeScript** — primary language for the reference parser, CLI, and web tooling
- **Python** — secondary parser library (Phase 2+)

## Runtime

- **Node.js** — CLI and server-side execution

## Frontend

- **Next.js 15 + React 19** — web application (Phase 2)
- **Tailwind CSS** — web app styling
- **react-markdown + remark-gfm** — Markdown rendering in the web app
- VS Code extension API (Phase 2)
- Obsidian plugin API (Phase 4)

## Backend

- **Next.js API routes** — web app server (uses ChatterMatter core library directly)
- N/A for Phase 1 (CLI is local-only)

## Database

- N/A — ChatterMatter is file-native by design; no database required for core functionality

## Other

- **GitHub Actions** — CI/CD and the AI review action
- **Claude API** — AI-powered document review (`chattermatter review`)
- **npm** — package distribution
