# Product Mission

## Problem

Every knowledge worker who writes in Markdown faces the same broken workflow: the conversation about a document and the document itself live in different systems. You copy to Google Docs for non-technical reviewers (lossy round-trips, drifting copies), open a PR for engineers (inaccessible to product and legal), or paste into Slack (immediately lost). Comments are trapped in proprietary platforms, destroyed on finalization ("Accept All Changes"), and lost during platform migrations.

The decision trail — why a document became what it is — is systematically destroyed when documents are finalized.

## Target Users

1. **Engineering teams** writing RFCs, ADRs, design docs, and runbooks in Markdown repos
2. **Technical writers** maintaining docs-as-code pipelines (MkDocs, Docusaurus, mdBook)
3. **Legal teams** reviewing contracts where negotiation history has legal significance
4. **Policy teams** where auditors need to trace why a policy says what it says
5. **Academic collaborators** writing papers in Markdown with multiple reviewers
6. **Any team** that copies Markdown to Google Docs for review and copies it back

## Solution

ChatterMatter puts the conversation *inside* the document as structured JSON blocks in standard Markdown fenced code blocks. This gives us:

- **File-native** — comments travel with the file, no service dependency
- **Loss-tolerant** — documents remain valid Markdown regardless of client support
- **Typed comments** — machine-readable comment intent (question, suggestion, approval, AI feedback)
- **AI-native** — designed as an output format for AI document review
- **Git-compatible but Git-optional** — works with version control, doesn't require it
- **Decision trail preservation** — the review history is the document's memory

**One-sentence pitch:** Track changes and comments for Markdown — portable, AI-native, and independent of any platform.
