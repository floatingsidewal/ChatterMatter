# ChatterMatter Feature Backlog

Future improvements and optimizations to consider for upcoming milestones.

---

## Performance Optimizations

### P2P: Event-Based Comment Sync (vs Real-Time)

**Priority:** Medium
**Complexity:** Low
**Added:** 2026-02-20

Currently, comment changes sync in real-time via Yjs CRDT with debouncing. For most use cases, syncing only on explicit user actions would reduce traffic and complexity.

**Proposed change:**
- Sync comments only on explicit actions: Save, Delete, Resolve, Add Reply
- Remove continuous CRDT observation for comment edits
- Keep real-time sync for document content (markdown) if needed

**Benefits:**
- Reduced network traffic
- Simpler conflict resolution (fewer intermediate states)
- Better for high-latency connections

**Trade-offs:**
- Users won't see each other's in-progress edits (acceptable for comments)
- Need clear "save" action in UI

---

## UI/UX Improvements

### Rendered Markdown in Peer ReviewPanel (with Raw Toggle)

**Priority:** Medium
**Complexity:** Medium
**Added:** 2026-02-20

Currently the peer's ReviewPanel shows raw markdown text. Rendering it as formatted HTML would improve the review experience, with an option to switch to raw view.

**Proposed change:**
- Add toggle button in ReviewPanel header: "Rendered" / "Raw" (or icon toggle)
- Default to rendered view for better reading experience
- Use a markdown renderer (e.g., `marked`, `markdown-it`) in the WebView
- Render the document as formatted HTML (headings, lists, code blocks, etc.)
- Apply comment anchor highlights in both views
- Raw view useful for: precise text selection, debugging anchor issues, seeing exact source

**UI placement options:**
- Toggle button in document pane header (next to file path)
- Keyboard shortcut (e.g., Ctrl+Shift+R to toggle)
- Remember preference in VS Code settings

**Benefits:**
- Better reading experience for document reviewers (rendered)
- Precise anchoring and debugging available (raw)
- User choice based on workflow

**Challenges:**
- Mapping rendered positions back to raw markdown for anchors
- Ensuring anchor text matches work correctly in rendered output
- Code blocks and other special elements need careful handling

### Inline Role Badge (Clickable)

**Priority:** Medium
**Complexity:** Low
**Added:** 2026-02-20

Add a clickable role badge next to peer names in the ReviewPanel sidebar, allowing the owner to quickly change a peer's role without navigating through the command palette.

**Proposed change:**
- Display role badge (e.g., "reviewer", "moderator", "viewer") next to each peer's name in comments
- Owner can click the badge to open a dropdown with role options
- Immediate feedback when role changes
- Badge styling: color-coded (green=moderator, blue=reviewer, gray=viewer)

**Benefits:**
- Faster role management for owners
- Visual indication of each commenter's permissions
- More discoverable than command palette

**Implementation notes:**
- Add role badge in `renderCommentCard()` function
- Owner-only: show clickable badge; others see static badge
- Use VS Code-style dropdown or inline quick pick

---

### Peer Presence Indicators

Show which peers are currently viewing or editing specific sections of the document.

### Typing Indicators

Show when peers are actively typing a comment.

### Comment Notifications

Toast/notification when new comments arrive from peers.

---

---

## Networking Improvements

### WebRTC for NAT Traversal

**Priority:** Medium
**Complexity:** High
**Added:** 2026-02-20

Current WebSocket implementation requires direct network connectivity. WebRTC would enable:
- NAT traversal via ICE/STUN/TURN
- Encrypted connections by default (DTLS)
- Browser-native P2P support for future web app
- Better corporate network compatibility

**Implementation path:**
1. Add signaling server (lightweight, stateless)
2. Replace WebSocket with WebRTC DataChannels
3. Use y-webrtc provider alongside existing Yjs sync
4. WebSocket fallback for restrictive environments

**Dependencies:**
- Signaling server infrastructure
- STUN/TURN server access (can use public servers initially)

### TLS for WebSocket Connections

**Priority:** High for enterprise
**Complexity:** Medium
**Added:** 2026-02-20

Add `wss://` support for encrypted WebSocket connections:
- Self-signed certificates for local development
- Let's Encrypt for production deployments
- Certificate management in settings

---

## Authentication & Security

### Session Authentication

**Priority:** High
**Complexity:** Medium
**Added:** 2026-02-20

Current sessions have no authentication. Options to consider:
1. **Shared secret** — Owner generates a session password, peers enter it to join
2. **Invite links with token** — Time-limited, single-use or multi-use tokens
3. **OAuth integration** — Link to GitHub, Microsoft, Google accounts

**Recommendation:** Start with shared secret (simple, no infrastructure), add invite links for better UX.

### Verified Identity

**Priority:** Low (enterprise)
**Complexity:** High
**Added:** 2026-02-20

Self-declared display names are sufficient for Phase 2. Enterprise needs:
- Verifiable identity via SSO
- Audit trail with real user IDs
- Integration with corporate directories

---

## Future Phases

See `2026-02-20-p2p-phase-3/shape.md` for the current roadmap:
- Phase 3.1: Roles & Permissions ✅ COMPLETED
- Phase 3.2: Session Persistence (next)
- Phase 3.3: Backup Owner & History
