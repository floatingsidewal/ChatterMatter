# P2P Owner-Client Architecture for ChatterMatter

> **Implementation Status:** Phase 1-2 complete using WebSocket transport. WebRTC is designed but not yet implemented. See [Current Implementation](#current-implementation) for what's working today.

## Problem Statement

ChatterMatter currently defines a file-native comment format (§13 of the spec explicitly defers real-time collaboration, transport, and permissions). We want to enable **live, collaborative review sessions** where:

1. An **owner** (document owner) hosts a review session
2. **Clients** (reviewers) connect to the owner and participate in near real-time
3. All writes to `.chatter` sidecar files are stored **locally on each client's machine**
4. All mutations flow **through the owner**, who is the authoritative relay
5. Many clients can participate simultaneously (many-to-many channels)

## Current Implementation

**What's built (Phase 1-2):**
- WebSocket-based star topology (owner hosts, clients connect)
- Yjs CRDT for conflict-free real-time sync
- Role-based permissions: owner, moderator, reviewer, viewer
- Validation layer prevents invalid blocks
- Rate limiting prevents spam
- Auto-reconnect on disconnect
- VS Code extension with host/join commands
- WebView for peers to view document and add comments

**What's designed but not built (Phase 3+):**
- WebRTC transport (NAT traversal, encryption)
- Session persistence (save/resume)
- Backup owner (failover)
- Session history/audit

## Architecture Overview

### Current: WebSocket Star Topology

```
         ┌────────────┐   ┌────────────┐   ┌────────────┐
         │ Client A   │   │  OWNER     │   │ Client B   │
         │ (reviewer) │   │  (host)    │   │ (viewer)   │
         └─────┬──────┘   └─────┬──────┘   └─────┬──────┘
               │                │                │
               │◄───────────────┤────────────────►│
               │   WebSocket    │   WebSocket    │
               │                │                │
         ┌─────▼──────┐  ┌─────▼──────┐   ┌─────▼──────┐
         │ .chatter   │  │ .chatter   │   │ (WebView)  │
         │ (local)    │  │ (local)    │   │            │
         └────────────┘  └────────────┘   └────────────┘
```

### Future: WebRTC with Signaling

```
                    ┌─────────────────┐
                    │   Signaling      │
                    │   Server         │
                    │   (lightweight)  │
                    └────────┬────────┘
                             │ discovery only
              ┌──────────────┼──────────────┐
              │              │              │
         ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
         │ Client A │   │ OWNER   │   │ Client C │
         │ (peer)   │   │ (host)  │   │ (peer)   │
         └────┬─────┘   └────┬────┘   └─────┬───┘
              │              │              │
              │◄─────────────┤──────────────►│
              │   WebRTC     │   WebRTC     │
              │   DataChannel│   DataChannel│
              │              │              │
         ┌────▼─────┐  ┌────▼────┐   ┌────▼────┐
         │ local     │  │ local   │   │ local   │
         │ .chatter  │  │ .chatter│   │ .chatter│
         │ file      │  │ file    │   │ .file   │
         └──────────┘  └─────────┘   └─────────┘
```

**Topology: Star with owner as hub.** Clients never talk directly to each other. All operations route through the master, who validates, sequences, and relays them to all connected peers. This is not a pure mesh — it is a **hub-and-spoke** model that keeps the master authoritative.

## Protocol Recommendation

### Transport Layer: WebRTC Data Channels

WebRTC Data Channels are the best fit for this architecture:

- **True P2P** — after signaling, data flows directly between the master and each client with no server relay in the data path
- **Low latency** — SCTP over DTLS gives sub-100ms delivery for typical connections
- **NAT traversal** — ICE/STUN/TURN handles most network configurations
- **Browser-native** — works in all major browsers, aligning with the Phase 2 web app
- **Binary support** — can send binary CRDT sync messages efficiently
- **Encryption by default** — DTLS provides transport security

**Why not WebSockets?** WebSockets require a persistent server in the data path. The master's machine *is* the server in this model — WebRTC lets the master host without running server infrastructure. WebSocket fallback is recommended for environments where WebRTC fails (restrictive firewalls, symmetric NATs without TURN).

**Why not libp2p?** libp2p is powerful but adds significant complexity (DHT, transport negotiation, protocol multiplexing). For a star topology with a known master, WebRTC Data Channels are simpler and sufficient. libp2p could be reconsidered if the architecture evolves toward fully decentralized P2P.

**Why not Matrix?** Matrix is a federated messaging protocol with a heavy homeserver requirement. It is overengineered for document review sessions where the master already provides the authority model. If ChatterMatter ever needs persistent rooms with history across sessions, Matrix's room semantics could be relevant.

### Data Synchronization: CRDTs (Yjs)

ChatterMatter blocks are independent JSON objects with unique IDs. This maps naturally to a CRDT model:

| ChatterMatter operation | CRDT operation |
|------------------------|----------------|
| Add a new comment block | Insert into Y.Map |
| Resolve a thread (set status) | Update field in Y.Map entry |
| Add a reply (new block with parent_id) | Insert into Y.Map (threading is structural) |
| Delete a block | Delete from Y.Map |

**Recommended library: [Yjs](https://yjs.dev/)**

- Mature, battle-tested CRDT framework for JavaScript/TypeScript
- Has a first-party WebRTC provider ([y-webrtc](https://github.com/yjs/y-webrtc))
- Supports offline editing — operations queue locally and merge on reconnect
- Awareness protocol for presence (who's online, cursor positions)
- IndexedDB persistence for local storage
- Binary sync protocol is compact and efficient

**Why Yjs over Automerge?** Yjs has a more mature ecosystem, better WebRTC integration out of the box, and is faster for the Map-oriented data model that ChatterMatter uses. Automerge's Rust/WASM approach is better for complex nested document structures, which isn't the primary need here.

### Serialization: Binary CRDT Protocol + MessagePack

- Yjs uses its own binary sync protocol for CRDT state exchange (efficient, compact)
- For application-level messages (presence, session control), use [MessagePack](https://msgpack.org/) — binary-compatible, smaller than JSON, and faster to parse
- JSON fallback for debugging and interop

## Detailed Design

### Session Lifecycle

```
1. MASTER creates a session
   → generates a session ID (ULID)
   → initializes a Yjs Doc with existing .chatter blocks
   → starts listening for WebRTC connections via signaling server

2. CLIENT joins a session
   → connects to signaling server with session ID
   → WebRTC handshake with master (ICE, DTLS)
   → receives full CRDT state sync from master
   → renders the document with all current blocks

3. CLIENT makes a change
   → local Yjs update (immediate local render)
   → CRDT update sent to master via WebRTC DataChannel
   → master validates the update (see Validation below)
   → if valid: master applies update, relays to all other clients
   → if invalid: master sends rejection message, client rolls back

4. MASTER makes a change
   → local Yjs update (immediate local render)
   → CRDT update broadcast to all clients

5. CLIENT disconnects
   → master removes from peer list
   → client's local .chatter file retains the last-synced state
   → on reconnect: incremental CRDT sync catches up

6. SESSION ends
   → master stops accepting connections
   → all clients retain their local .chatter files
```

### Master Validation Layer

The master is not just a relay — it validates all incoming operations before applying and broadcasting them. This is critical because CRDTs by default accept all operations (eventual consistency). The master adds **authority**:

```typescript
interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// Master validates every incoming CRDT update before applying
function validateUpdate(update: Uint8Array, peerId: string): ValidationResult {
  // 1. Decode the update to inspect operations
  // 2. Check: does this peer have permission to write?
  // 3. Check: are all new block IDs unique?
  // 4. Check: do parent_id references resolve?
  // 5. Check: is the block schema valid (required fields)?
  // 6. Check: rate limiting (prevent spam)
  return { valid: true };
}
```

Operations the master rejects:
- Blocks with duplicate IDs
- Blocks referencing non-existent parent_ids (unless the parent is in the same batch)
- Blocks with invalid required fields
- Updates from peers without write permission
- Updates that violate rate limits

### Many-to-Many Channel Design

For **many-to-many** near real-time updates with the master-as-hub model:

#### Small Groups (2-20 clients) — WebRTC Star

```
Client A ◄──── WebRTC ────► MASTER ◄──── WebRTC ────► Client B
                               ▲
                               │ WebRTC
                               ▼
                           Client C
```

- Each client has ONE WebRTC connection (to the master)
- Master maintains N connections (one per client)
- Master broadcasts updates to all connected clients
- Latency: ~1 RTT (client → master → other clients)
- This scales to ~20 peers comfortably on a single master

#### Medium Groups (20-100 clients) — WebSocket Relay Hybrid

For larger groups, the master runs a lightweight WebSocket server alongside WebRTC:

- Preferred clients use WebRTC (lower latency)
- Overflow clients fall back to WebSocket
- Master broadcasts via both channels
- Use the Yjs `y-websocket` provider alongside `y-webrtc`

#### Large Groups (100+) — Sharded Relay

For very large review sessions (unlikely for document review but worth planning):

- Shard by document section or thread
- Clients subscribe to relevant shards
- Master delegates relay to lightweight shard servers
- This is a Phase 3+ concern

### Local Storage Architecture

Every participant (master and clients) stores state locally:

```
project/
├── document.md                    ← the document being reviewed
├── document.md.chatter            ← the .chatter sidecar (ChatterMatter blocks)
└── .chattermatter/
    ├── sessions/
    │   └── <session-id>.crdt      ← Yjs binary state snapshot
    ├── peers/
    │   └── <peer-id>.json         ← peer metadata (display name, last seen)
    └── config.json                ← local preferences, signaling server URL
```

- `.chatter` file is the **canonical output** — a standard ChatterMatter sidecar per the spec
- `.chattermatter/sessions/` stores CRDT state for resuming sessions
- On session end, the CRDT state is materialized into the `.chatter` file
- The `.chatter` file can be committed to git, shared via email, etc. — it's just the spec format

### Message Protocol

All messages over WebRTC DataChannels follow this envelope:

```typescript
type Message =
  | { type: "sync";     data: Uint8Array }        // Yjs sync protocol
  | { type: "awareness"; data: Uint8Array }        // Yjs awareness (presence)
  | { type: "reject";   blockId: string; reason: string }  // master rejects an update
  | { type: "session";  action: "join" | "leave" | "end"; peerId: string }
  | { type: "auth";     token: string }            // session authentication
  | { type: "ping" }                               // keepalive
  | { type: "pong" }                               // keepalive response
```

Messages are serialized with MessagePack. The `sync` and `awareness` types carry raw Yjs binary payloads.

### Conflict Resolution

CRDTs handle most conflicts automatically, but ChatterMatter-specific rules apply:

| Conflict | Resolution |
|----------|-----------|
| Two clients add blocks with same ID | Master rejects the second one (validation layer) |
| Client resolves a thread while another adds a reply | Both operations apply — thread is resolved with one more reply. CRDT merge handles this naturally |
| Client edits a block while another resolves it | Last-writer-wins on the `status` field; both changes to `content` merge if using Y.Text |
| Offline client reconnects with stale state | Yjs incremental sync merges cleanly — no data loss |

**Key principle:** Block *additions* are conflict-free (unique IDs). Block *mutations* (status changes, edits) use last-writer-wins with lamport timestamps, which Yjs provides out of the box.

### Presence and Awareness

Yjs includes an [Awareness protocol](https://docs.yjs.dev/api/about-awareness) for lightweight presence data:

```typescript
awareness.setLocalStateField("user", {
  name: "Alice",
  color: "#ff0000",
  activeAnchor: "heading:Introduction",  // what section they're looking at
  cursor: { blockId: "c1", offset: 42 }  // if editing a block
});
```

This enables:
- Seeing who's online in the review session
- Seeing which section each reviewer is looking at
- Seeing real-time typing indicators when someone is composing a comment

### Security Model

| Concern | Approach |
|---------|----------|
| Session authentication | Session ID + short-lived token (master generates, shares via invite link) |
| Transport encryption | WebRTC DTLS (automatic) |
| Authorization | Master validates all operations; can assign roles (reviewer, viewer) |
| Peer identity | Self-declared display names in v1; verifiable identity deferred to later |
| Signaling server trust | Signaling server only facilitates WebRTC handshake; never sees document content |

### Signaling Server

The signaling server is minimal — it only facilitates WebRTC connection establishment:

- Stateless — no document data passes through it
- Can be a shared public server or self-hosted
- Protocol: WebSocket-based (standard for WebRTC signaling)
- `y-webrtc` includes a reference signaling server implementation
- Alternatives: Use a STUN/TURN service like Cloudflare, Twilio, or self-hosted coturn

## Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| CRDT engine | **Yjs** | Mature, fast, Map-oriented, great WebRTC support |
| P2P transport | **WebRTC Data Channels** via y-webrtc | Browser-native, low latency, encrypted |
| Fallback transport | **WebSocket** via y-websocket | For restrictive networks |
| Local persistence | **y-indexeddb** (browser) / filesystem (CLI) | Offline support, session resume |
| Serialization | **Yjs binary protocol** + **MessagePack** | Compact, fast |
| Signaling | **y-webrtc signaling server** | Reference implementation, minimal |
| Presence | **Yjs Awareness protocol** | Built-in, lightweight |

## Integration with Existing Spec

This P2P layer is **additive** — it does not change the ChatterMatter format spec:

- The `.chatter` sidecar file remains the canonical output format
- P2P sync is a **transport concern** (§13 explicitly defers this)
- The CRDT layer syncs ChatterMatter block operations in real-time
- When a session ends, the CRDT state materializes into a standard `.chatter` file
- Users without P2P can still read and write `.chatter` files manually

The spec's round-trip preservation rule (§9) is critical: the CRDT layer must preserve unknown fields when syncing blocks.

## Open Questions

1. **Should clients be able to talk to each other directly (mesh) or strictly through the master (star)?** — This design proposes star-only. Mesh would reduce latency for client-to-client communication but complicates the master's authority model.

2. **Should the master be able to delegate authority?** — e.g., a "co-owner" who can also validate. This adds complexity but improves resilience.

3. **What happens when the master goes offline mid-session?** — Options: (a) session pauses, clients retain local state; (b) a pre-designated backup master takes over; (c) clients continue in read-only mode.

4. **Should session history persist beyond the session?** — The `.chatter` file captures the final state, but the CRDT history (who wrote what when, edit history) could be valuable.

5. **Invite mechanism** — How does the master share session access? Options: shareable link with embedded token, QR code, CLI command.

## Phasing

| Phase | Scope | Status |
|-------|-------|--------|
| **P2P Phase 1** | Owner-client star topology, WebSocket (not WebRTC), Yjs sync, basic presence. | ✅ Complete |
| **P2P Phase 2** | VS Code extension, session management UI, WebView for peers. | ✅ Complete |
| **P2P Phase 2b** | Roles and permissions (owner/moderator/reviewer/viewer), cascade delete. | ✅ Complete |
| **P2P Phase 3.1** | Session persistence (save/resume). | Planned |
| **P2P Phase 3.2** | Backup owner, session history/audit. | Planned |
| **P2P Phase 4** | WebRTC upgrade for NAT traversal, authentication. | Future |

> **Note:** Phase 1-2 was implemented with WebSocket instead of WebRTC for simplicity. WebRTC remains the long-term target for better NAT traversal and browser support. See the backlog for WebRTC migration path.

## References

- [Yjs — Shared data types for collaborative software](https://yjs.dev/)
- [y-webrtc — WebRTC connector for Yjs](https://github.com/yjs/y-webrtc)
- [WebRTC Data Channels — MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [libp2p — modular P2P networking stack](https://libp2p.io/)
- [Matrix P2P spec discussion](https://github.com/matrix-org/matrix-spec/issues/201)
- [Iroh — pragmatic P2P framework](https://ark-builders.medium.com/the-deceptive-complexity-of-p2p-connections-and-the-solution-we-found-d2b5cbeddbaf)
- [CRDTs and Operational Transform comparison](https://www.daydreamsoft.com/blog/real-time-collaboration-features-using-crdts-and-operational-transform)
- [Building Real-Time Collaborative Applications (WebRTC + CRDTs)](https://medium.com/@himansusaha/building-real-time-collaborative-applications-a-deep-dive-into-webrtc-websockets-and-conflict-9eb75800e221)
