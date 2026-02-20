# ChatterMatter: Market Research

## The Landscape

### Existing Markdown Annotation Approaches

| Tool / Standard | Approach | Limitation |
|----------------|----------|------------|
| **CriticMarkup** | Inline syntax (`{++add++}`, `{--del--}`, `{>>comment<<}`) | No threading, no metadata, no structured types. Breaks Markdown rendering |
| **W3C Web Annotation** | External JSON-LD linked to document ranges | Service-dependent, doesn't travel with the file, complex spec |
| **Hypothesis** | Browser overlay with external annotation store | Requires a running service, annotations don't live in the document |
| **GitHub PR Reviews** | Line-level comments on diffs | Code-oriented, not prose-oriented. Comments live in the platform, not the file |
| **Google Docs** | Proprietary sidebar comments | Trapped in Google's ecosystem. Lost on export |
| **Word Track Changes** | Proprietary inline markup | Corrupts on cross-platform conversion. Destroyed on "Accept All" |

### The Gap

No existing tool provides **structured, typed, threaded comments that live inside a Markdown file** and survive every text pipeline. ChatterMatter occupies this gap.

---

## User Behavior Patterns

Research into how people actually use document comments reveals six distinct comment types that tools treat identically:

1. **Suggestions / Proposed Edits** — The most common type. Users want to propose a specific change with a rationale. Tools rarely capture the "why"
2. **Questions / Clarification Requests** — Expect a reply, not a document edit. Spawn the longest threads
3. **Flags / Warnings** — "Legal needs to review this," "TK placeholder." Teams develop shorthand that tools can't parse
4. **Approvals / Sign-offs** — Status transitions, not conversations. Often the terminal node in a thread
5. **Positive Feedback** — Social signals ("Nice paragraph!") that serve morale, not editing. Low information density
6. **Task Assignments** — "@Sarah verify these numbers." Workflow instructions attached to a location

### Key Behavioral Findings

- **Conversations fragment** across comments, email, and chat. The #1 pain point
- **Resolved comments become invisible.** Most users don't know Google Docs has a resolved comments panel
- **Comments disappear when changes are accepted.** In Word, accepting a tracked change closes associated threads
- **Cross-platform conversion corrupts comments.** Word-to-Docs round-trips lose comment formatting
- **No structured state tracking.** Users resort to "Q:", "ACTION:", "FYI" prefixes — unstructured workarounds for missing type fields
- **Nobody resolves general comments.** @mentions exist because undirected comments go unanswered

---

## Review Workflow Patterns

### How Review Actually Works

1. One person produces a draft
2. Draft is circulated (email link, shared drive, direct share)
3. Reviewers comment asynchronously — rarely synchronously, even in real-time tools
4. The original author processes feedback — accepting, rejecting, or replying
5. A second round occurs if changes were substantial
6. Someone informally declares the document "done"

### Casual vs. Enterprise

| Dimension | Casual | Enterprise |
|-----------|--------|-----------|
| Participants | 2-5 people | Defined approval chains with named roles |
| Rounds | Ad hoc, comment-when-ready | Sequential stages with explicit criteria |
| Resolution | "Looks good to me" in Slack | Formal sign-off with audit trail |
| Versioning | Safety net | Governance requirement |
| Completion | Author says it's done | Compliance requires documented approval |

### The Common Problem

Both casual and enterprise workflows suffer from the same core issue: **the conversation about the document and the document itself are separate artifacts that drift apart.** Enterprise tools add workflow automation but don't solve this fundamental disconnect.

---

## What Gets Lost at Finalization

When documents are finalized ("Accept All Changes" + delete comments), the following is systematically destroyed:

- The rationale behind every editorial decision
- Alternative approaches that were considered and rejected
- Questions asked and answered (which often reveal ambiguities)
- Disagreements that were resolved and the compromises reached
- The evolution of thinking throughout the review

This is the **institutional knowledge problem**: clean documents capture the "what" but not the "why." ChatterMatter's embedded approach preserves the full deliberation alongside the final text.

---

## Market Opportunity

### Who Needs This

1. **Engineering teams** writing RFCs, ADRs, design docs, and runbooks in Markdown repos
2. **Technical writers** maintaining docs-as-code pipelines (MkDocs, Docusaurus, mdBook)
3. **Legal teams** reviewing contracts where negotiation history has legal significance
4. **Policy teams** where auditors need to trace why a policy says what it says
5. **Academic collaborators** writing papers in Markdown/LaTeX with multiple reviewers
6. **Any team** that copies Markdown to Google Docs for review and copies it back

### Competitive Positioning

ChatterMatter is differentiated by being:
- **File-native** — comments travel with the file, no service dependency
- **Typed** — machine-readable comment intent (question, suggestion, approval)
- **AI-native** — designed as an output format for AI document review
- **Git-compatible but Git-optional** — works with version control, doesn't require it
- **Platform-independent** — survives every text pipeline that preserves code fences

---

## Sources

- Park & Lee, "Why 'why'? The Importance of Communicating Rationales for Edits" (CHI 2023)
- Kim & Eklundh, "Reviewing Practices in Collaborative Writing" (CSCW)
- PMC, "Collaborative writing: Strategies and activities" (2021)
- Document360, "The Documentation Review Process"
- W3C Web Annotation Data Model specification
- CriticMarkup specification (criticmarkup.com)
- Hypothesis annotation platform documentation
