# ChatterMatter: Product Vision & Creative Analysis

## The Core Problem Nobody Has Solved

Every knowledge worker has lived this scenario:

You write a document in Markdown. You need feedback. Now you have three bad options:

1. **Copy it into Google Docs** — your non-technical reviewers can comment, but the round-trip back to Markdown is lossy and manual. Two copies drift apart. Comments are trapped in Google's database.

2. **Open a pull request** — your engineers can review, but product managers, legal, and marketing won't touch a PR. Line-level diff comments are designed for code, not prose. The review UI thinks in hunks, not paragraphs.

3. **Paste it into Slack and ask for feedback** — the discussion is immediate and then immediately lost. Three days later nobody can find the thread.

The conversation about a document and the document itself live in different systems that don't talk to each other. This is the fundamental problem.

ChatterMatter puts the conversation *inside* the document.

---

## Five Insights That Make This Marketable

### 1. The Document Should Remember Why It Became What It Is

This is ChatterMatter's most powerful and least obvious value proposition.

When a document is finalized in Word or Google Docs, the standard process is: accept all changes, resolve all comments, produce a "clean copy." This ritual **systematically destroys institutional knowledge**:

- Why was this paragraph rewritten? Gone.
- What alternative approach was considered and rejected? Gone.
- Which stakeholder pushed back on this section, and what compromise was reached? Gone.
- What question a reader had that revealed an ambiguity? Gone.

The decision trail vanishes. Six months later, a new team member reads the document, has the same questions that were already answered, and nobody remembers the answers.

**ChatterMatter solves this without any extra work.** Comments live in the file as fenced code blocks. A renderer hides resolved comments. A tool that strips ChatterMatter blocks produces a clean Markdown file. But the original file — with all its blocks — is the annotated archive. The history is in the document, not in a proprietary database that gets lost during a platform migration.

**The pitch:** "Your documents remember every decision that shaped them."

This matters most for:
- **Architecture Decision Records (ADRs)** — the rationale IS the deliverable
- **Legal contracts** — the negotiation history has legal significance
- **Policy documents** — auditors want to know why a policy says what it says
- **RFCs and design docs** — rejected alternatives are as important as the chosen approach

---

### 2. The Sidecar File: Clean Docs, Rich Review

The spec currently embeds ChatterMatter blocks inline. This is correct as a format definition, but the most marketable user experience is a **sidecar pattern**:

```
proposal.md           ← clean Markdown, no ChatterMatter blocks
proposal.md.chatter   ← all ChatterMatter blocks, anchored to proposal.md
```

This gives you three powerful properties:

**Separation of concerns.** The document is always clean, always renderable, always diffable. The review layer is a companion file that references it. This is how `.srt` subtitles work alongside video files — the content and the commentary are separate artifacts with a shared reference frame.

**Access control.** The document might be public. The review conversation might be private. Internal disagreements, legal concerns, and candid feedback don't belong in the published artifact. A sidecar file lets you share the document without sharing the deliberation.

**Opt-in complexity.** A user who doesn't care about ChatterMatter never sees it. Their Markdown editor shows a normal `.md` file. A ChatterMatter-aware editor detects the `.chatter` sidecar and renders the overlay. Zero cost for non-participants.

The spec should define both modes:
- **Inline mode** (current spec): blocks embedded in the `.md` file. Good for self-contained documents where the review history is part of the deliverable (ADRs, RFCs).
- **Sidecar mode** (new): blocks in a companion file. Good for published documents, shared templates, and scenarios where review is private.

Both modes use the same JSON format and anchor model. The only difference is where the blocks live.

---

### 3. AI as a First-Class Document Reviewer

41% of new code pushed to GitHub is now AI-assisted. AI code review tools (CodeRabbit, Qodo, Copilot) have exploded. But AI *document* review — reviewing the substance of prose, not just syntax — is almost entirely unserved.

No tool today provides AI-powered feedback on whether an RFC has considered enough alternatives, whether a design doc has an adequate rollback plan, whether a policy document has internal contradictions, or whether a proposal's cost estimates are realistic.

ChatterMatter is the natural output format for AI document reviewers.

Consider this workflow:

1. Author writes `design-proposal.md`
2. Author runs `chattermatter review design-proposal.md`
3. An AI reads the document and produces ChatterMatter blocks:

```chattermatter
{
  "id": "ai-1",
  "type": "ai_feedback",
  "anchor": { "type": "heading", "text": "Rollback Plan" },
  "content": "This section describes how to roll back the database migration but doesn't address rolling back the API changes that depend on the new schema. Consider adding API versioning to the rollback procedure.",
  "metadata": {
    "model": "claude-opus-4-6",
    "confidence": "high",
    "category": "completeness"
  }
}
```

4. Human reviewers see AI feedback alongside their own comments
5. AI comments are accepted, dismissed, or discussed — just like human comments
6. The AI's reasoning becomes part of the document's decision trail

**Why this matters:** The #1 complaint about AI code review is noise — too many false positives cause developers to ignore all AI feedback. ChatterMatter's type system (`ai_feedback` vs. `comment`) lets renderers visually distinguish AI and human commentary, and lets users configure their own signal-to-noise ratio.

**The pitch:** "AI reviews your documents the way a senior colleague would — with structured, anchored, dismissable feedback that doesn't pollute your inbox."

**Product angles:**
- A CLI tool: `chattermatter review <file>` — AI reviews any Markdown document
- A GitHub Action: AI reviews `.md` files in PRs and writes ChatterMatter blocks
- An editor plugin: AI suggestions appear as a sidebar overlay in VS Code / Obsidian
- A pre-merge check: "All AI feedback must be resolved before merging"

---

### 4. Review Without Git, Compatible With Git

The user experience that matters most is this:

> "I wrote a doc. I want three people to review it. Two of them have never heard of Git."

ChatterMatter enables this without requiring Git, PRs, or any developer tooling:

**The simplest workflow (no Git):**
1. Author shares `proposal.md` via email, Dropbox, or a shared drive
2. Reviewer opens it in a ChatterMatter-aware editor (web app, VS Code plugin, Obsidian plugin)
3. Reviewer highlights text, types a comment. The editor writes a ChatterMatter block anchored to the highlighted text
4. Reviewer saves and sends the file back (or it syncs via shared drive)
5. Author opens the file. Comments appear as an overlay on the rendered document
6. Author responds, resolves, or edits. The cycle repeats

No branches. No diffs. No merge conflicts. Just a file with comments in it.

**The Git-enhanced workflow (when the doc lives in a repo):**
1. Everything above, plus: the review history is version-controlled
2. `git diff` shows exactly which comments were added, resolved, or modified
3. Multiple reviewers can work on branches — ChatterMatter blocks with unique IDs merge cleanly in most cases
4. PR comments remain PR comments (outside the document). ChatterMatter comments are inside the document. They serve different purposes and don't interfere with each other

**The key insight:** Git compatibility is a *bonus*, not a requirement. The file format works without any infrastructure. This is what makes it different from every existing collaboration tool — the collaboration data is in the file, not in a service.

---

### 5. Typed Comments Change How People Review

Research consistently shows that all comments in Word and Google Docs look the same. Users resort to ad-hoc conventions — prefixing comments with "Q:", "ACTION:", "SUGGESTION:", "FYI" — to signal intent. These conventions are unstructured, inconsistent, and invisible to tools.

ChatterMatter's `type` field makes comment intent machine-readable:

| Type | What it means | How a renderer could treat it |
|------|--------------|-------------------------------|
| `question` | "I need clarification" | Show with a `?` icon. Track unanswered questions. Surface them in a "needs response" panel |
| `suggestion` | "Consider this change" | Show as an inline diff with accept/reject buttons |
| `comment` | "Here's my feedback" | Standard comment bubble |
| `ai_feedback` | "An AI flagged this" | Dimmed or collapsible by default. Expandable on demand |
| `reaction` | "I like this" / "+1" | Emoji badge on the text. No sidebar clutter |
| `resolution` | "This thread is resolved because..." | Collapse the thread. Show a summary |

This isn't just cosmetic. Typed comments enable:

- **Review dashboards:** "This document has 3 unanswered questions, 2 unresolved suggestions, and 1 blocking concern"
- **Review completeness checks:** "All questions must be answered before this document is approved"
- **Filtering:** "Show me only suggestions" / "Hide AI feedback" / "Show blocking comments only"
- **Notification routing:** Questions go to the author. Suggestions go to the editor. Legal flags go to the legal team

**The deeper product insight:** A review system with typed comments shifts document review from "a pile of undifferentiated feedback" to "a structured workflow with clear resolution criteria." This is the difference between a comment thread and a checklist.

---

## Three Product Shapes This Could Take

### Shape 1: The Format + CLI (Open Source Foundation)

- The ChatterMatter spec as an open standard
- A reference parser library (TypeScript + Python)
- A CLI tool: `chattermatter add`, `chattermatter list`, `chattermatter resolve`, `chattermatter strip`, `chattermatter review`
- Editor plugins for VS Code and Obsidian that render the overlay
- GitHub Action for AI review

**Why it works:** Low barrier to adoption. Developers can use it immediately. The format spreads through `.md` files shared between projects. Network effects emerge as more tools understand ChatterMatter blocks.

**Revenue model:** Open core. The format and CLI are free. A hosted dashboard for teams (review status across documents, reviewer assignment, analytics) is paid.

### Shape 2: The Web App (Accessible Collaboration)

- A web application where you upload or link a Markdown file
- Renders the document beautifully
- Non-technical reviewers comment by highlighting text — no Markdown knowledge needed
- Comments are stored as ChatterMatter blocks in the file
- The file can be downloaded, synced to a repo, or shared via link
- AI review is a button click away

**Why it works:** Solves the "copy to Google Docs for review" problem directly. Non-technical users get a Google Docs-like experience. Technical users get a portable, version-controlled, Markdown-native file.

**Revenue model:** Free for individuals. Paid for teams (shared workspaces, review assignments, integrations with Slack/Teams).

### Shape 3: The Review Layer for Docs-as-Code (Enterprise)

- Targets engineering organizations that already use Markdown for RFCs, ADRs, runbooks, and design docs
- Integrates with existing docs-as-code pipelines (MkDocs, Docusaurus, mdBook, Quarto)
- Adds a review layer on top of rendered documentation sites
- Comments are written back to the source `.md` files as ChatterMatter blocks
- Review workflows: assign reviewers, set deadlines, track approval status
- AI review of technical documents: completeness, consistency, cross-reference checking

**Why it works:** Engineering teams already write in Markdown and host in repos. They just need a review experience that doesn't force non-engineers through a PR workflow.

**Revenue model:** Per-seat SaaS. Enterprise features: SSO, audit logs, compliance reporting, custom AI review prompts.

---

## What This Is NOT

ChatterMatter is not trying to be:

- **A real-time collaboration tool** (Notion, Google Docs). It's async-first and file-first.
- **A project management tool** (Jira, Linear). Comments are about document content, not task tracking.
- **A CMS** (Contentful, Strapi). It doesn't manage content lifecycle — it annotates content wherever it lives.
- **A Git hosting platform** (GitHub, GitLab). It works with Git but doesn't require it.

It's a **format** that makes Markdown documents conversational, and a **toolchain** that makes that conversation useful.

---

## The One-Sentence Pitch

**ChatterMatter is track changes and comments for Markdown — portable, AI-native, and independent of any platform.**
