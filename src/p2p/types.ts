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

export interface PeerInfo {
  peerId: string;
  name: string;
  role: "master" | "reviewer" | "viewer";
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
  | { type: "session_ended" }
  | { type: "error"; message: string };

export type SessionEventHandler = (event: SessionEvent) => void;
