/**
 * P2P module — collaborative review sessions for ChatterMatter.
 *
 * Star topology: master hosts, clients connect via WebSocket.
 * Yjs CRDTs handle state synchronization and conflict resolution.
 */

// Session types
export type {
  SessionConfig,
  SessionInfo,
  PeerInfo,
  Message,
  ValidationResult,
  SessionEvent,
  SessionEventHandler,
} from "./types.js";

// Sessions
export { MasterSession } from "./master.js";
export { ClientSession } from "./client.js";

// Yjs-ChatterMatter bridge
export {
  createDoc,
  createEmptyDoc,
  getBlocksMap,
  getBlocks,
  getBlock,
  setBlock,
  deleteBlock,
  materialize,
  observeBlocks,
} from "./sync.js";
export type { BlockChange } from "./sync.js";

// Validation
export { MasterValidator } from "./validation.js";

// Presence
export { PresenceManager } from "./presence.js";
export type { PresenceState, PeerPresence } from "./presence.js";

// Protocol
export { encodeMessage, decodeMessage } from "./protocol.js";
