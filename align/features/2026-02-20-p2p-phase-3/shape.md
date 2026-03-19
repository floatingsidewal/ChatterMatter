# P2P Phase 3: Enterprise-Ready Collaboration

## Context

P2P Phase 1-2 delivered working collaborative review sessions:
- Owner hosts via WebSocket, clients connect
- Yjs CRDT syncs blocks in real-time
- Validation layer prevents invalid blocks
- Rate limiting prevents spam
- Presence shows who's online
- Auto-reconnect on disconnect

Phase 3 adds the features needed for production/enterprise use.

## Current State (Updated 2026-02-20)

**What exists:**
- `MasterSession` hosts on a port, validates all writes
- `ClientSession` connects, syncs, reconnects on failure
- **Roles enforced:** `owner`, `moderator`, `reviewer`, `viewer`
  - Owner: full control, can delete any comment, manage roles
  - Moderator: can add, resolve, and delete comments
  - Reviewer: can add and resolve comments
  - Viewer: read-only access
- **Dynamic role management:** owner can promote/demote peers via Show Peers dialog
- **Cascade delete:** deleting a thread deletes all replies
- **Delete all resolved:** owner can bulk-delete resolved threads
- No session persistence — if owner restarts, session is lost
- Single point of failure — no backup owner

**What's missing:**
1. ~~Role enforcement~~ ✅ Completed
2. ~~Dynamic role management~~ ✅ Completed
3. Session persistence (resume after restart)
4. Backup owner for fault tolerance
5. Session history/audit (who wrote what when)

## Scope

### 1. Roles & Permissions ✅ COMPLETED

**Goal:** Enforce role-based permissions at the validation layer.

**Implementation (completed):**
- Four roles: `owner`, `moderator`, `reviewer`, `viewer`
- `MasterValidator` checks roles on all operations
- Viewers rejected with "Permission denied: viewer role cannot write"
- Reviewers rejected on delete with "Permission denied: role cannot delete"
- `role_change` message broadcasts role changes to all peers
- Owner can change roles via "Show Peers" → select peer → "Change Role"

**Permissions matrix:**
| Action | Owner | Moderator | Reviewer | Viewer |
|--------|-------|-----------|----------|--------|
| Add comment | ✅ | ✅ | ✅ | ❌ |
| Resolve comment | ✅ | ✅ | ✅ | ❌ |
| Delete comment | ✅ | ✅ | ❌ | ❌ |
| Change roles | ✅ | ❌ | ❌ | ❌ |
| Delete resolved | ✅ | ❌ | ❌ | ❌ |

**Future:** Block-level ownership ("only author can edit")

### 2. Session Persistence

**Goal:** Owner can stop and resume a session; clients reconnect seamlessly.

**Current behavior:**
- Session state lives in memory
- Owner restart = session lost, clients fail to reconnect

**Changes:**

a. **Persist session metadata**
   - Store in `.chattermatter/sessions/<session-id>/`
     - `meta.json`: sessionId, masterName, documentPath, createdAt
     - `state.crdt`: Yjs binary state (full doc snapshot)
     - `peers.json`: last-known peer list (informational)

b. **Save on interval + on stop**
   - Auto-save every 30 seconds
   - Save on `session.stop()`
   - Save on SIGINT/SIGTERM

c. **Resume command**
   - `chattermatter session resume <session-id>`
   - Loads meta.json and state.crdt
   - Starts server on same port (or new if occupied)
   - Clients reconnect via existing auto-reconnect

d. **Session listing**
   - `chattermatter session list`
   - Shows saved sessions with metadata

### 3. Backup Owner (Fault Tolerance)

**Goal:** Designate a co-owner who can take over if primary owner goes offline.

**Current behavior:**
- Single owner, single point of failure
- Owner offline = session paused until reconnect or restart

**Changes:**

a. **Co-owner role**
   - New role: `co_owner` (in addition to owner, moderator, reviewer, viewer)
   - Owner can designate co-owner via role management
   - Only one co-owner at a time

b. **State replication**
   - Co-owner receives full CRDT state (already happens via sync)
   - Co-owner receives peer list and session metadata

c. **Failover protocol**
   - When clients detect owner disconnect, they attempt reconnect
   - If owner is unreachable for N seconds (configurable, default 30):
     - Co-owner announces takeover: `{ type: "failover", newOwner: peerId }`
     - Co-owner starts WebSocket server on a new port
     - Clients reconnect to co-owner
   - Co-owner becomes owner, can designate new co-owner

d. **Owner recovery**
   - Original owner rejoins as reviewer (not automatic takeover)
   - Manual coordination: `chattermatter session resume` with `--as-owner` flag

**Complexity note:** Failover is the most complex feature in Phase 3. Consider shipping 3.1 (roles + persistence) before 3.2 (failover).

### 4. Session History (Audit)

**Goal:** Track who made what changes for accountability.

**Current behavior:**
- Events are emitted (`block_added`, `block_updated`) but not persisted
- No history after session ends

**Changes:**

a. **Event log**
   - Append-only log in `.chattermatter/sessions/<session-id>/history.jsonl`
   - Each line: `{ timestamp, event_type, peerId, peerName, data }`

b. **Events logged:**
   - `session_started`
   - `peer_joined` (peerId, name, role)
   - `peer_left` (peerId)
   - `block_added` (blockId, author)
   - `block_updated` (blockId, editor, fields changed)
   - `block_rejected` (blockId, peerId, reason)
   - `role_changed` (peerId, oldRole, newRole)
   - `session_ended`

c. **History command**
   - `chattermatter session history <session-id>`
   - Shows chronological event log

## Design Decisions

### Why persist to filesystem (not database)?
- ChatterMatter's philosophy: everything lives with the document
- `.chattermatter/` directory is gitignore-able but portable
- No external dependencies for local sessions

### Why co-master instead of consensus?
- Star topology is simpler to reason about
- Enterprise use cases usually have clear ownership
- Consensus (Raft, PBFT) is overkill for document review

### Why JSONL for history instead of SQLite?
- Human-readable, grep-able
- Easy to export/import
- Append-only is crash-safe
- No dependencies

## Out of Scope (Phase 4+)

- Large group sharding (100+ peers)
- Permanent room URLs (requires signaling server with state)
- SSO integration
- Block-level permissions (author-only edit)
- Real-time cursor positions in document (need anchor coordinates)

## Open Questions

1. **Failover timing:** How long should clients wait before failover? 30s? Configurable?
2. **Port conflict on resume:** What if the original port is in use? Auto-select new port?
3. **History retention:** How long to keep history? Forever? Configurable cleanup?
4. **Multiple co-masters:** Should we allow >1 co-master for larger teams?

## Phasing Recommendation

**3.1: Roles & Permissions** ✅ COMPLETED
- Role enforcement in validator
- Four roles: owner, moderator, reviewer, viewer
- Dynamic role management
- Cascade delete for threads
- Delete all resolved

**3.2: Session Persistence** (next)
- Session save/resume
- Session listing
- Lower risk, high value

**3.3: Backup Owner + History** (future)
- Failover protocol
- Event logging
- Higher complexity, dependent on 3.2
