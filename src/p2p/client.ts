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
  deleteBlock as syncDeleteBlock,
  materialize,
  observeBlocks,
} from "./sync.js";
import { PresenceManager } from "./presence.js";
import { encodeMessage, decodeMessage } from "./protocol.js";
import type {
  SessionInfo,
  PeerInfo,
  Message,
  SessionEvent,
  SessionEventHandler,
} from "./types.js";
import type { Block, Anchor, BlockType } from "../types.js";

const RECONNECT_DELAYS = [2000, 4000, 8000, 16000];
const PING_INTERVAL = 30_000;

export class ClientSession {
  readonly doc: Y.Doc;
  readonly presence: PresenceManager;

  private ws: WebSocket | null = null;
  private peerId: string;
  private peerName: string;
  private url: string;
  private sessionInfo: SessionInfo | null = null;
  private eventHandlers: SessionEventHandler[] = [];
  private cleanupObserver: (() => void) | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private connected = false;
  private authenticated = false;

  constructor(options: {
    url: string;
    peerId: string;
    name: string;
  }) {
    this.url = options.url;
    this.peerId = options.peerId;
    this.peerName = options.name;
    this.doc = createEmptyDoc();
    this.presence = new PresenceManager(this.doc, options.name);
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
        this.send({
          type: "auth",
          peerId: this.peerId,
          name: this.peerName,
          role: "reviewer",
        });

        // Start ping keepalive
        this.startPing();
      });

      this.ws.on("message", (raw: Buffer) => {
        try {
          const msg = decodeMessage(raw);
          this.handleMessage(msg, resolve);
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

      // Set up local change observation to send to master
      this.cleanupObserver = observeBlocks(this.doc, (changes, origin) => {
        // Only send changes that originated locally (not from sync)
        if (origin === "remote") return;
        this.sendDocUpdate();
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
   * Delete a block by ID.
   */
  deleteBlock(blockId: string): boolean {
    return syncDeleteBlock(this.doc, blockId);
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
  ): void {
    switch (msg.type) {
      case "auth_ok":
        this.authenticated = true;
        this.sessionInfo = msg.sessionInfo;
        if (authResolve) authResolve(msg.sessionInfo);
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

    const update = Y.encodeStateAsUpdate(this.doc);
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
