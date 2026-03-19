/**
 * ClientSession — connects to a master's review session.
 *
 * The client:
 * - Connects to the master via WebSocket
 * - Receives the full CRDT state on join
 * - Sends local edits to the master for validation and relay
 * - Receives updates from other peers via the master
 * - Stores state locally in a .chatter sidecar file
 */

import { WebSocket } from "ws";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness.js";
import {
  createEmptyDoc,
  getBlocks,
  setBlock,
  deleteBlockWithChildren,
  materialize,
  observeBlocks,
} from "./sync.js";
import { PresenceManager } from "./presence.js";
import { encodeMessage, decodeMessage } from "./protocol.js";
import { extractTokenFromUrl } from "./tokens.js";
import type {
  SessionInfo,
  PeerInfo,
  PeerRole,
  Message,
  SessionEvent,
  SessionEventHandler,
} from "./types.js";
import type { Block, Anchor, BlockType } from "../types.js";

const RECONNECT_DELAYS = [2000, 4000, 8000, 16000];
const PING_INTERVAL = 30_000;

export interface DocumentContent {
  markdown: string;
  path: string;
}

export class ClientSession {
  readonly doc: Y.Doc;
  readonly presence: PresenceManager;

  private ws: WebSocket | null = null;
  private peerId: string;
  private peerName: string;
  private peerRole: PeerRole;
  private url: string;
  private sessionInfo: SessionInfo | null = null;
  private documentContent: DocumentContent | null = null;
  private eventHandlers: SessionEventHandler[] = [];
  private cleanupObserver: (() => void) | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private connected = false;
  private authenticated = false;
  private lastSentStateVector: Uint8Array | null = null;
  private token: string | null = null;

  constructor(options: {
    url: string;
    peerId: string;
    name: string;
    role?: PeerRole;
  }) {
    this.url = options.url;
    this.peerId = options.peerId;
    this.peerName = options.name;
    this.peerRole = options.role ?? "reviewer";
    this.doc = createEmptyDoc();
    this.presence = new PresenceManager(this.doc, options.name);

    // Extract token from URL if present
    this.token = extractTokenFromUrl(options.url);
  }

  /**
   * Get the current role of this client.
   */
  getRole(): PeerRole {
    return this.peerRole;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Connect to the master session.
   */
  connect(): Promise<SessionInfo> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = "nodebuffer";

      this.ws.on("open", () => {
        this.connected = true;
        this.reconnectAttempt = 0;

        // Send auth message
        // Auth only accepts "reviewer" or "viewer" - owner/moderator roles are assigned by the host
        const authRole = (this.peerRole === "reviewer" || this.peerRole === "viewer")
          ? this.peerRole
          : "reviewer";
        const authMsg: Message & { type: "auth" } = {
          type: "auth",
          peerId: this.peerId,
          name: this.peerName,
          role: authRole,
        };
        // Include token if present
        if (this.token) {
          authMsg.token = this.token;
        }
        this.send(authMsg);

        // Start ping keepalive
        this.startPing();
      });

      this.ws.on("message", (raw: Buffer) => {
        try {
          const msg = decodeMessage(raw);
          this.handleMessage(msg, resolve, reject);
        } catch (err) {
          this.emit({
            type: "error",
            message: `Message decode error: ${(err as Error).message}`,
          });
        }
      });

      this.ws.on("close", (code, reason) => {
        this.connected = false;
        this.authenticated = false;
        this.stopPing();

        if (code === 1000) {
          // Normal close
          this.emit({ type: "session_ended" });
        } else {
          this.emit({
            type: "error",
            message: `Disconnected: ${reason.toString() || code}`,
          });
          this.attemptReconnect();
        }
      });

      this.ws.on("error", (err) => {
        if (!this.authenticated) {
          reject(err);
        }
        this.emit({ type: "error", message: `WebSocket error: ${err.message}` });
      });

      // Set up observation for all block changes
      this.cleanupObserver = observeBlocks(this.doc, (changes, origin) => {
        // Emit events for all changes (local and remote)
        for (const change of changes) {
          if (change.action === "add") {
            this.emit({ type: "block_added", blockId: change.blockId, peerId: this.peerId });
          } else if (change.action === "update") {
            this.emit({ type: "block_updated", blockId: change.blockId, peerId: this.peerId });
          } else if (change.action === "delete") {
            this.emit({ type: "block_deleted", blockId: change.blockId, peerId: this.peerId });
          }
        }

        // Only send updates to master for local changes (not from sync)
        if (origin !== "remote") {
          this.sendDocUpdate();
        }
      });
    });
  }

  /**
   * Disconnect from the session gracefully.
   */
  disconnect(): void {
    this.stopPing();

    if (this.cleanupObserver) {
      this.cleanupObserver();
      this.cleanupObserver = null;
    }

    if (this.ws && this.connected) {
      this.ws.close(1000, "Client disconnecting");
    }

    this.presence.destroy();
  }

  // -------------------------------------------------------------------------
  // Operations (write to local Yjs doc, then sync to master)
  // -------------------------------------------------------------------------

  /**
   * Add a new comment block.
   */
  addBlock(block: Block): void {
    setBlock(this.doc, block);
  }

  /**
   * Update an existing block (e.g. resolve).
   */
  updateBlock(block: Block): void {
    setBlock(this.doc, block);
  }

  /**
   * Delete a block and all its children by ID.
   */
  deleteBlock(blockId: string): boolean {
    const deleted = deleteBlockWithChildren(this.doc, blockId);
    return deleted.length > 0;
  }

  /**
   * Get all current blocks.
   */
  getBlocks(): Block[] {
    return getBlocks(this.doc);
  }

  /**
   * Get the current session info (received from master).
   */
  getSessionInfo(): SessionInfo | null {
    return this.sessionInfo;
  }

  /**
   * Get the document content received from master.
   */
  getDocument(): DocumentContent | null {
    return this.documentContent;
  }

  /**
   * Materialize current state to a string (for writing to a local .chatter file).
   */
  materialize(): string {
    return materialize(this.doc);
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  private handleMessage(
    msg: Message,
    authResolve?: (info: SessionInfo) => void,
    authReject?: (err: Error) => void,
  ): void {
    switch (msg.type) {
      case "auth_ok":
        this.authenticated = true;
        this.sessionInfo = msg.sessionInfo;
        if (authResolve) authResolve(msg.sessionInfo);
        break;

      case "auth_rejected":
        this.emit({ type: "error", message: msg.reason });
        // Don't reconnect - auth was explicitly rejected
        this.reconnectAttempt = RECONNECT_DELAYS.length;
        if (authReject) authReject(new Error(msg.reason));
        break;

      case "doc_content":
        this.documentContent = {
          markdown: msg.markdown,
          path: msg.path,
        };
        // Emit event so UI can update
        this.emit({ type: "document_updated" });
        break;

      case "sync":
        // Apply state update from master
        Y.applyUpdate(this.doc, msg.data, "remote");
        break;

      case "awareness":
        awarenessProtocol.applyAwarenessUpdate(
          this.presence.awareness,
          msg.data,
          this.ws,
        );
        break;

      case "reject":
        this.emit({
          type: "block_rejected",
          blockId: msg.blockId,
          peerId: this.peerId,
          reason: msg.reason,
        });
        break;

      case "session":
        if (msg.action === "join") {
          this.emit({
            type: "peer_joined",
            peer: {
              peerId: msg.peerId,
              name: msg.name ?? "unknown",
              role: "reviewer",
              connectedAt: new Date().toISOString(),
            },
          });
        } else if (msg.action === "leave") {
          this.emit({ type: "peer_left", peerId: msg.peerId });
        } else if (msg.action === "end") {
          this.emit({ type: "session_ended" });
          this.disconnect();
        }
        break;

      case "role_change":
        // Update our own role if this message is for us
        if (msg.peerId === this.peerId) {
          const oldRole = this.peerRole;
          this.peerRole = msg.newRole;
          this.emit({ type: "role_changed", peerId: msg.peerId, oldRole, newRole: msg.newRole });
        } else {
          // Emit event for other peer role changes (we don't track their roles locally)
          this.emit({ type: "role_changed", peerId: msg.peerId, oldRole: "viewer", newRole: msg.newRole });
        }
        break;

      case "pong":
        // Keepalive acknowledged
        break;

      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  private sendDocUpdate(): void {
    if (!this.ws || !this.authenticated) return;

    // Send incremental update based on last sent state (more efficient)
    const update = this.lastSentStateVector
      ? Y.encodeStateAsUpdate(this.doc, this.lastSentStateVector)
      : Y.encodeStateAsUpdate(this.doc);

    // Update the state vector for next incremental send
    this.lastSentStateVector = Y.encodeStateVector(this.doc);

    this.send({ type: "sync", data: update });
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private send(msg: Message): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeMessage(msg));
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, PING_INTERVAL);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempt >= RECONNECT_DELAYS.length) {
      this.emit({
        type: "error",
        message: "Max reconnection attempts reached",
      });
      return;
    }

    const delay = RECONNECT_DELAYS[this.reconnectAttempt];
    this.reconnectAttempt++;

    setTimeout(() => {
      this.connect().catch(() => {
        // Reconnect will be attempted again on close
      });
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  onEvent(handler: SessionEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  private emit(event: SessionEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }
}
