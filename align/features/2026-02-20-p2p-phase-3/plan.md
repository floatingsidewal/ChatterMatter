# P2P Phase 3 Implementation Plan

## Overview

Enterprise-ready P2P collaboration: role enforcement, session persistence, backup master, and audit history.

## Phase 3.1: Roles & Persistence

### Step 1: Enforce Roles in Validator

**Files:** `src/p2p/validation.ts`, `src/p2p/types.ts`

1. Add `peerRole` parameter to `MasterValidator.validateAdd/Update/Delete`
2. Return `{ valid: false, reason: "Permission denied: viewers cannot write" }` if role is `viewer`
3. Update `validateUpdate_fromDiff` to accept and propagate role

### Step 2: Pass Role Through Master

**Files:** `src/p2p/master.ts`

1. Track peer roles in `ConnectedPeer.info.role`
2. Pass role to validator calls in `handleSync`

### Step 3: Dynamic Role Changes

**Files:** `src/p2p/types.ts`, `src/p2p/master.ts`, `src/p2p/client.ts`, `src/cli/session.ts`

1. Add `role_change` message type
2. Master: `changePeerRole(peerId, newRole)` method
3. Broadcast role change to all peers
4. Client: update local peer info on role_change
5. CLI: `promote <name>` and `demote <name>` commands

### Step 4: Session Metadata Storage

**Files:** `src/p2p/storage.ts` (new), `src/p2p/types.ts`

1. Create `SessionStorage` class:
   - `saveSession(session)` — write meta.json + state.crdt
   - `loadSession(sessionId)` — read back
   - `listSessions()` — scan .chattermatter/sessions/
   - `deleteSession(sessionId)` — remove session dir

2. Define storage paths:
   ```
   .chattermatter/sessions/<session-id>/
   ├── meta.json     # { sessionId, masterName, documentPath, port, createdAt, updatedAt }
   ├── state.crdt    # Yjs encodeStateAsUpdate binary
   └── peers.json    # [ { peerId, name, role, lastSeen } ]
   ```

### Step 5: Auto-Save in Master

**Files:** `src/p2p/master.ts`

1. Add `autoSaveInterval` option (default 30000ms)
2. Start interval timer on `start()`
3. Call `storage.saveSession()` on each tick
4. Clear timer on `stop()`
5. Save on SIGINT/SIGTERM (via event handler)

### Step 6: Resume Command

**Files:** `src/cli/session.ts`

1. Add `chattermatter session resume <session-id>` command
2. Load session via `SessionStorage.loadSession()`
3. Create `MasterSession` with loaded state
4. Handle port conflicts: try original port, fallback to next available

### Step 7: List Sessions Command

**Files:** `src/cli/session.ts`

1. Add `chattermatter session list` command
2. Display: sessionId, documentPath, createdAt, updatedAt, status

---

## Phase 3.2: Backup Master & History

### Step 8: Co-Master Role

**Files:** `src/p2p/types.ts`, `src/p2p/master.ts`

1. Add `co_master` to role union
2. Track co-master peerId in `MasterSession`
3. CLI: `co-master <name>` to designate

### Step 9: State Replication to Co-Master

**Files:** `src/p2p/master.ts`

1. Send session metadata to co-master on designation
2. Send peer list updates to co-master

### Step 10: Failover Detection (Client Side)

**Files:** `src/p2p/client.ts`

1. Track `failoverCandidate` (co-master URL/peer)
2. On master disconnect + timeout, check for `failover` message
3. If received, reconnect to new master URL

### Step 11: Failover Announcement (Co-Master Side)

**Files:** `src/p2p/client.ts`, `src/p2p/master.ts`

1. Co-master detects master gone (WebSocket close + no pong)
2. Co-master promotes self: start MasterSession
3. Broadcast `failover` message via signaling (requires design)
4. Complexity: need out-of-band signaling for failover announcement

**Alternative (simpler):**
- Clients poll a known fallback URL
- Co-master starts on a pre-announced port
- On master disconnect, clients try fallback URL

### Step 12: Event History Logger

**Files:** `src/p2p/history.ts` (new), `src/p2p/master.ts`

1. Create `HistoryLogger` class:
   - `log(event)` — append to history.jsonl
   - `getHistory(sessionId)` — read and parse

2. Events to log:
   - session_started, session_ended
   - peer_joined, peer_left
   - block_added, block_updated, block_rejected
   - role_changed

3. Wire into `MasterSession.emit()` to auto-log

### Step 13: History CLI Command

**Files:** `src/cli/session.ts`

1. Add `chattermatter session history <session-id>` command
2. Output formatted event log

---

## Testing Strategy

### Unit Tests
- `validation.test.ts`: role enforcement
- `storage.test.ts`: save/load/list sessions
- `history.test.ts`: event logging

### Integration Tests
- Two-client session with role changes
- Master restart + client reconnect
- Session resume with state preservation

### Manual Tests
- Full session flow: host → join → comment → resolve → quit
- Resume workflow: host → quit → resume → verify state

---

## Estimated Complexity

| Component | Effort | Risk |
|-----------|--------|------|
| Role enforcement | Low | Low |
| Dynamic roles | Low | Low |
| Session storage | Medium | Low |
| Auto-save | Low | Low |
| Resume command | Medium | Medium (port conflicts) |
| List command | Low | Low |
| Co-master designation | Low | Low |
| Failover protocol | High | High |
| Event history | Medium | Low |

**Recommendation:** Ship 3.1 (Steps 1-7) first. Evaluate failover complexity before committing to 3.2.
