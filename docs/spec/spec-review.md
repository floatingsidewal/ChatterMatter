# Chattermatter v0.1 Spec Review

## Overall Assessment

The spec is well-structured and makes sound foundational choices: embedding in standard Markdown fences, loss-tolerant design, and separating transport from rendering. The core idea — conversational metadata that degrades gracefully into inert code blocks — is solid.

The issues below range from ambiguities that will cause interoperability problems to design choices that should be reconsidered before implementation begins.

---

## Critical Issues

### 1. `type: "thread"` conflicts with the threading model

Section 4.1 lists `thread` as a valid value for the `type` field. Section 6 defines threading via a `thread` *field* that references a parent ID. These two uses of the word "thread" collide. What is a block with `"type": "thread"`? A container? A grouping node? A comment that starts a thread?

Meanwhile, any block *without* a `thread` field is already a root-level entry per Section 6. So the `type: "thread"` value appears to be either redundant or undefined.

**Recommendation:** Remove `thread` from the type enum. Threads are an emergent structure from the `thread` field, not a block type. If you need an explicit "thread root" marker, define it as a boolean field (`"is_thread_root": true`) rather than overloading `type`.

### 2. `type: "suggestion"` has no diff semantics

The spec lists `suggestion` as a type but defers inline diff format to Future Directions (Section 12). Without a defined way to express *what is being suggested*, a suggestion is just a comment with a different label. Parsers and clients can't do anything meaningful with it.

**Recommendation:** Either define a minimal replacement format now:

```json
{
  "type": "suggestion",
  "anchor": { "type": "text", "exact": "introduces the idea" },
  "content": "introduces the core concept",
  "suggestion": {
    "original": "introduces the idea",
    "replacement": "introduces the core concept"
  }
}
```

Or remove `suggestion` from v0.1 and introduce it properly in v0.2.

### 3. `type: "resolution"` overlaps with `status` field

Section 4.1 defines `resolution` as a type. Section 4.2 defines `"status": "open | resolved"` as an optional field. These serve overlapping purposes. Is a `resolution` block a status transition event? If so, it should reference the block it resolves. If `status` is a mutable property on any block, then `resolution` as a type is redundant.

**Recommendation:** Pick one mechanism. Either:
- `status` is a field on any block (simpler), or
- `resolution` is an event block that references a target via `thread` field (audit trail friendly)

Don't have both without defining their relationship.

### 4. Text anchor ambiguity with duplicate matches

The text quote anchor (Section 5.1) can match multiple locations in a document. The spec says `context_before` and `context_after` exist but doesn't state that they serve as disambiguation. It also doesn't define behavior when:
- `exact` matches zero times (anchor fails)
- `exact` matches multiple times even with context (ambiguous anchor)

**Recommendation:** Add explicit resolution rules:
1. If `exact` + context matches exactly one location, use it.
2. If multiple matches remain, use the *first* match (or fail — pick one and state it).
3. If zero matches, the anchor is unresolved. Define what clients MUST do (e.g., mark as orphaned, still display in a sidebar).

---

## Significant Issues

### 5. Block index anchor (5.3) is nearly as fragile as character offsets

The spec discourages character offsets in 5.4 but recommends block index in 5.3. Any insertion or deletion of a Markdown block above the target shifts all subsequent indices. This has the same fundamental fragility problem.

**Recommendation:** Acknowledge the fragility explicitly. Consider requiring block anchors to be used in combination with another anchor type as a fallback, or define block anchors as a hint rather than an authoritative locator.

### 6. HTML comment encoding can break on payload content

Section 3.2's `<!--chattermatter ... -->` encoding will break if the JSON payload contains the string `-->`. This is a real risk with `content` fields that discuss HTML or Markdown.

**Recommendation:** State that the HTML comment encoding MUST NOT be used if the JSON payload contains `-->`, or define an escaping scheme.

### 7. No error handling guidance

The spec doesn't address:
- **Duplicate IDs** — two blocks with the same `id` in one document.
- **Circular thread references** — `c1.thread = "c2"`, `c2.thread = "c1"`.
- **Orphaned threads** — `thread` references a non-existent ID.
- **Malformed JSON** — syntactically invalid JSON inside a valid chattermatter fence.

**Recommendation:** Add a section on error handling. At minimum: clients MUST ignore blocks with invalid JSON, SHOULD warn on duplicate IDs, and MUST treat circular thread references as root-level entries.

### 8. `type: "reaction"` needs constraints

Reactions in every major platform (GitHub, Slack, etc.) use a constrained set of values, not freeform content. The spec uses `content` for the reaction payload, but doesn't indicate whether it should be an emoji, a code, or arbitrary text.

**Recommendation:** Either constrain `content` for reactions (e.g., "MUST be a single emoji or a short predefined string") or add a `reaction` field and make `content` optional for this type.

---

## Minor Issues

### 9. JSON strictness

"Valid UTF-8 JSON" is underspecified. State RFC 8259 compliance explicitly. Clarify that JSON5 features (comments, trailing commas, unquoted keys) are NOT permitted.

### 10. Ordering semantics need clarification

Section 8 says "treat ordering as irrelevant." But threaded conversations have inherent temporal ordering. The spec should clarify: *document position* is irrelevant; *display ordering* should derive from `timestamp` and thread structure.

### 11. `spec_version` per-block allows version mixing

Section 9 places `spec_version` on individual blocks. This means a single document could contain blocks claiming different spec versions. Is this intentional? If so, state that clients MUST handle mixed versions. If not, consider a document-level version assertion (e.g., a special block with `"type": "meta"`).

### 12. ID format should be stronger

"UUID recommended" is too weak for multi-author scenarios. If two authors independently create blocks, ID collisions will cause data corruption. Either require UUIDs or define a namespacing scheme (e.g., `author:uuid`).

### 13. Round-trip preservation of `metadata`

The open `metadata` object is fine for extensibility, but the spec should state whether compliant tools MUST preserve unknown metadata fields when reading and rewriting a document. Without this guarantee, metadata added by one tool will be silently dropped by another.

### 14. Multiple blocks per document

The spec describes individual blocks but doesn't explicitly state that all blocks in a document share a single conversation namespace. This matters for thread resolution — can block `c2` in document A reference block `c1` in document B? Likely not, but state it.

---

## What the Spec Gets Right

- **Fenced code block embedding** is the correct default. It's visible in dumb renderers, invisible in smart ones, and survives every Markdown pipeline.
- **Loss tolerance** is a strong design property. Documents remain valid regardless of client support.
- **Anchor diversity** with a clear preference order (text > heading > block > offset) gives implementations flexibility.
- **Threading via parent references** is proven and simple.
- **"Ignore unknown fields"** is the right forward-compatibility rule.
- **Separating transport from rendering** keeps the spec focused and avoids premature UI decisions.

---

## Suggested Priorities Before Implementation

1. Resolve the `type` enum — remove or precisely define `thread`, `suggestion`, and `resolution`.
2. Define anchor failure behavior.
3. Add error handling rules (duplicate IDs, circular threads, malformed JSON).
4. Constrain reaction semantics.
5. Specify JSON as RFC 8259.
6. State round-trip preservation requirements.

These six items would make v0.1 implementable without ambiguity. Everything else can wait for v0.2.
