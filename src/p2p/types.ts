/**
 * P2P session types for ChatterMatter collaborative review.
 *
 * Star topology: master hosts, clients connect via WebSocket.
 * All writes flow through the master who validates and relays.
 */

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface SessionConfig {
  /** ULID session identifier. */
  sessionId: string;
  /** Display name of the session creator. */
  masterName: string;
  /** Path to the document being reviewed. */
  documentPath: string;
  /** Port for the WebSocket server. */
  port: number;
  /** Optional sidecar mode (write blocks to .chatter file instead of inline). */
  sidecar?: boolean;
  /** Auto-save interval in milliseconds (default: 30000). */
  autoSaveInterval?: number;
  /** Initial CRDT state to resume from (Yjs encoded state). */
  initialState?: Uint8Array;
}

export interface SessionInfo {
  sessionId: string;
  masterName: string;
  documentPath: string;
  peerCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Peers
// ---------------------------------------------------------------------------

export type PeerRole = "master" | "reviewer" | "viewer";

export interface PeerInfo {
  peerId: string;
  name: string;
  role: PeerRole;
  connectedAt: string;
}

// ---------------------------------------------------------------------------
// Messages over WebSocket
// ---------------------------------------------------------------------------

export type Message =
  | { type: "sync"; data: Uint8Array }
  | { type: "awareness"; data: Uint8Array }
  | { type: "reject"; blockId: string; reason: string }
  | { type: "session"; action: "join" | "leave" | "end"; peerId: string; name?: string }
  | { type: "auth"; peerId: string; name: string; role?: "reviewer" | "viewer" }
  | { type: "auth_ok"; peerId: string; sessionInfo: SessionInfo }
  | { type: "role_change"; peerId: string; newRole: PeerRole; changedBy: string }
  | { type: "doc_request" }
  | { type: "doc_content"; markdown: string; path: string }
  | { type: "ping" }
  | { type: "pong" };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Events emitted by sessions
// ---------------------------------------------------------------------------

export type SessionEvent =
  | { type: "peer_joined"; peer: PeerInfo }
  | { type: "peer_left"; peerId: string }
  | { type: "block_added"; blockId: string; peerId: string }
  | { type: "block_updated"; blockId: string; peerId: string }
  | { type: "block_rejected"; blockId: string; peerId: string; reason: string }
  | { type: "role_changed"; peerId: string; oldRole: PeerRole; newRole: PeerRole }
  | { type: "session_ended" }
  | { type: "error"; message: string };

export type SessionEventHandler = (event: SessionEvent) => void;
