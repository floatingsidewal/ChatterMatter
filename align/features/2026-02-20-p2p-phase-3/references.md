# P2P Phase 3 References

## Existing Code

### P2P Module
- `src/p2p/types.ts` — session/peer/message types (lines 36-56 define Message union)
- `src/p2p/validation.ts` — MasterValidator with rate limiting
- `src/p2p/master.ts` — MasterSession class
- `src/p2p/client.ts` — ClientSession class with auto-reconnect
- `src/p2p/sync.ts` — Yjs doc management
- `src/p2p/presence.ts` — awareness/presence
- `src/p2p/protocol.ts` — message encoding/decoding

### CLI
- `src/cli/session.ts` — host/join commands

### Key Integration Points

**Role checking location** (`src/p2p/master.ts:288-331`):
```typescript
private handleSync(ws: WebSocket, peerId: string, data: Uint8Array): void {
  // ... validation happens here
  const validation = this.validator.validateUpdate_fromDiff(
    this.doc,
    beforeIds,
    tempBlocksMap,
    peerId,  // <-- need to pass role here
  );
}
```

**Peer info storage** (`src/p2p/master.ts:255`):
```typescript
this.peers.set(peerId, { ws, info: peerInfo });
// peerInfo.role is already tracked
```

## Design Document

- `align/features/p2p-master-client.md` — original P2P architecture
  - Section "Open Questions" lists persistence and failover as future work
  - "Phasing" section defines Phase 3 scope

## Yjs APIs

**State serialization (for persistence):**
```typescript
import { encodeStateAsUpdate, applyUpdate } from "yjs";

// Save
const state = encodeStateAsUpdate(doc);
fs.writeFileSync("state.crdt", state);

// Load
const state = fs.readFileSync("state.crdt");
applyUpdate(doc, state);
```

**Awareness (for presence):**
```typescript
import { Awareness } from "y-protocols/awareness";
// Already used in presence.ts
```

## External References

- [Yjs persistence](https://docs.yjs.dev/api/shared-types#state-serialization) — binary state format
- [y-indexeddb](https://github.com/yjs/y-indexeddb) — browser persistence (not needed for CLI)
- [JSONL format](https://jsonlines.org/) — for history logging
