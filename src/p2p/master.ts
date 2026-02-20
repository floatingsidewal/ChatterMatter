/**
 * MasterSession — hosts a collaborative review session.
 *
 * The master:
 * - Runs a WebSocket server
 * - Holds the authoritative Yjs Doc
 * - Validates all incoming operations before applying and relaying
 * - Manages peer connections and presence
 * - Materializes CRDT state to .chatter files on demand
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import {
  encodeStateAsUpdate,
  applyUpdate,
  encodeStateVector,
} from "yjs";
import * as syncProtocol from "y-protocols/sync.js";
import * as awarenessProtocol from "y-protocols/awareness.js";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { ulid } from "ulid";
import { createDoc, createEmptyDoc, getBlocksMap, getBlocks, materialize, observeBlocks } from "./sync.js";
import { MasterValidator } from "./validation.js";
import { PresenceManager } from "./presence.js";
import { encodeMessage, decodeMessage } from "./protocol.js";
import { SessionStorage } from "./storage.js";
import type {
  SessionConfig,
  SessionInfo,
  PeerInfo,
  PeerRole,
  Message,
  SessionEvent,
  SessionEventHandler,
} from "./types.js";
import type { Block } from "../types.js";

// Message type prefixes for the Yjs protocol layer
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_APP = 2; // application-level (our Message type)

interface ConnectedPeer {
  ws: WebSocket;
  info: PeerInfo;
}

interface DocumentContent {
  markdown: string;
  path: string;
}

const DEFAULT_AUTO_SAVE_INTERVAL = 30_000; // 30 seconds

export class MasterSession {
  readonly sessionId: string;
  readonly doc: Y.Doc;
  readonly presence: PresenceManager;

  private wss: WebSocketServer | null = null;
  private peers = new Map<string, ConnectedPeer>();
  private validator: MasterValidator;
  private documentPath: string;
  private sidecar: boolean;
  private eventHandlers: SessionEventHandler[] = [];
  private cleanupObserver: (() => void) | null = null;
  private createdAt: string;
  private storage: SessionStorage;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private autoSaveInterval: number;
  private documentContent: DocumentContent | null = null;

  constructor(private config: SessionConfig) {
    this.sessionId = config.sessionId || ulid();
    this.documentPath = config.documentPath;
    this.sidecar = config.sidecar ?? true;
    this.createdAt = new Date().toISOString();
    this.autoSaveInterval = config.autoSaveInterval ?? DEFAULT_AUTO_SAVE_INTERVAL;

    // Initialize storage
    this.storage = new SessionStorage(config.documentPath);

    // Load from initial state if resuming, otherwise from file
    if (config.initialState) {
      this.doc = createEmptyDoc();
      Y.applyUpdate(this.doc, config.initialState);
    } else {
      const content = this.loadContent();
      this.doc = createDoc(content);
    }

    // Load the markdown document content for sharing with peers
    this.loadDocumentContent();

    this.validator = new MasterValidator();
    this.presence = new PresenceManager(this.doc, config.masterName);
  }

  /**
   * Load the markdown document content for sharing with peers.
   */
  private loadDocumentContent(): void {
    if (existsSync(this.documentPath)) {
      const markdown = readFileSync(this.documentPath, "utf-8");
      this.documentContent = {
        markdown,
        path: this.documentPath,
      };
    }
  }

  /**
   * Get the document content for sharing.
   */
  getDocumentContent(): DocumentContent | null {
    return this.documentContent;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the WebSocket server and begin accepting connections.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.config.port }, () => {
        resolve();
      });

      this.wss.on("error", (err) => {
        reject(err);
      });

      this.wss.on("connection", (ws) => {
        this.handleConnection(ws);
      });

      // Observe block changes for materialization
      this.cleanupObserver = observeBlocks(this.doc, (changes, origin) => {
        for (const change of changes) {
          if (change.action === "add") {
            this.emit({ type: "block_added", blockId: change.blockId, peerId: "master" });
          } else if (change.action === "update") {
            this.emit({ type: "block_updated", blockId: change.blockId, peerId: "master" });
          }
        }
      });

      // Start auto-save timer
      if (this.autoSaveInterval > 0) {
        this.autoSaveTimer = setInterval(() => {
          this.saveSession();
        }, this.autoSaveInterval);
      }
    });
  }

  /**
   * Stop the session, disconnect all peers, and materialize final state.
   */
  async stop(): Promise<void> {
    // Clear auto-save timer
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    // Notify all peers
    const endMsg: Message = { type: "session", action: "end", peerId: "master" };
    this.broadcast(endMsg);

    // Close all connections
    for (const [peerId, peer] of this.peers) {
      peer.ws.close(1000, "Session ended");
    }
    this.peers.clear();

    // Close server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    // Materialize final state to file
    this.save();

    // Save session state for potential resume
    this.saveSession();

    // Cleanup
    if (this.cleanupObserver) {
      this.cleanupObserver();
      this.cleanupObserver = null;
    }

    this.presence.destroy();
    this.emit({ type: "session_ended" });
  }

  // -------------------------------------------------------------------------
  // Session info
  // -------------------------------------------------------------------------

  getInfo(): SessionInfo {
    return {
      sessionId: this.sessionId,
      masterName: this.config.masterName,
      documentPath: this.documentPath,
      peerCount: this.peers.size,
      createdAt: this.createdAt,
    };
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values()).map((p) => p.info);
  }

  getBlocks(): Block[] {
    return getBlocks(this.doc);
  }

  /**
   * Find a peer by display name.
   */
  findPeerByName(name: string): PeerInfo | undefined {
    for (const peer of this.peers.values()) {
      if (peer.info.name.toLowerCase() === name.toLowerCase()) {
        return peer.info;
      }
    }
    return undefined;
  }

  /**
   * Change a peer's role. Only masters can change roles.
   * Returns true if the role was changed, false if peer not found.
   */
  changePeerRole(peerId: string, newRole: PeerRole): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;

    const oldRole = peer.info.role;
    if (oldRole === newRole) return true; // No change needed

    // Update the peer's role
    peer.info.role = newRole;

    // Broadcast role change to all peers
    const roleChangeMsg: Message = {
      type: "role_change",
      peerId,
      newRole,
      changedBy: this.config.masterName,
    };
    this.broadcast(roleChangeMsg);

    // Emit event
    this.emit({ type: "role_changed", peerId, oldRole, newRole });

    return true;
  }

  // -------------------------------------------------------------------------
  // File I/O
  // -------------------------------------------------------------------------

  private loadContent(): string {
    const path = this.sidecar
      ? this.documentPath + ".chatter"
      : this.documentPath;

    if (!existsSync(path)) return "";
    return readFileSync(path, "utf-8");
  }

  /**
   * Materialize current state to the sidecar or inline file.
   */
  save(): void {
    const content = materialize(this.doc);
    if (this.sidecar) {
      writeFileSync(this.documentPath + ".chatter", content, "utf-8");
    } else {
      // For inline mode, we'd need to merge blocks back into the markdown.
      // For P2P Phase 1, sidecar is the primary mode.
      writeFileSync(this.documentPath + ".chatter", content, "utf-8");
    }
  }

  /**
   * Save session state for potential resume.
   */
  saveSession(): void {
    this.storage.saveSession(
      this.sessionId,
      this.doc,
      {
        sessionId: this.sessionId,
        masterName: this.config.masterName,
        documentPath: this.documentPath,
        port: this.config.port,
        createdAt: this.createdAt,
        sidecar: this.sidecar,
      },
      this.getPeers(),
    );
  }

  /**
   * Get the session storage instance.
   */
  getStorage(): SessionStorage {
    return this.storage;
  }

  // -------------------------------------------------------------------------
  // Connection handling
  // -------------------------------------------------------------------------

  private handleConnection(ws: WebSocket): void {
    let peerId: string | null = null;

    ws.on("message", (raw: Buffer) => {
      try {
        const msg = decodeMessage(raw);
        if (!peerId && msg.type !== "auth") {
          // First message must be auth
          ws.close(4001, "Authentication required");
          return;
        }

        switch (msg.type) {
          case "auth":
            peerId = this.handleAuth(ws, msg);
            break;
          case "sync":
            if (peerId) this.handleSync(ws, peerId, msg.data);
            break;
          case "awareness":
            if (peerId) this.handleAwareness(ws, peerId, msg.data);
            break;
          case "ping":
            this.send(ws, { type: "pong" });
            break;
          default:
            break;
        }
      } catch (err) {
        this.emit({
          type: "error",
          message: `Message handling error: ${(err as Error).message}`,
        });
      }
    });

    ws.on("close", () => {
      if (peerId) {
        this.handleDisconnect(peerId);
      }
    });

    ws.on("error", (err) => {
      this.emit({ type: "error", message: `WebSocket error: ${err.message}` });
    });
  }

  private handleAuth(ws: WebSocket, msg: Message & { type: "auth" }): string {
    const peerId = msg.peerId;
    const peerInfo: PeerInfo = {
      peerId,
      name: msg.name,
      role: msg.role ?? "reviewer",
      connectedAt: new Date().toISOString(),
    };

    this.peers.set(peerId, { ws, info: peerInfo });

    // Send auth confirmation with session info
    this.send(ws, {
      type: "auth_ok",
      peerId,
      sessionInfo: this.getInfo(),
    });

    // Send document content for peers to view
    if (this.documentContent) {
      this.send(ws, {
        type: "doc_content",
        markdown: this.documentContent.markdown,
        path: this.documentContent.path,
      });
    }

    // Send full state sync
    const stateVector = Y.encodeStateVector(this.doc);
    const update = Y.encodeStateAsUpdate(this.doc);
    this.send(ws, { type: "sync", data: update });

    // Send current awareness state
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
      this.presence.awareness,
      Array.from(this.presence.awareness.getStates().keys()),
    );
    this.send(ws, { type: "awareness", data: awarenessUpdate });

    // Notify other peers
    this.broadcastExcept(peerId, {
      type: "session",
      action: "join",
      peerId,
      name: msg.name,
    });

    this.emit({ type: "peer_joined", peer: peerInfo });
    return peerId;
  }

  private handleSync(ws: WebSocket, peerId: string, data: Uint8Array): void {
    // Capture block IDs before applying the update
    const blocksMap = getBlocksMap(this.doc);
    const beforeIds = new Set<string>();
    blocksMap.forEach((_v, k) => beforeIds.add(k));

    // Look up peer role
    const peer = this.peers.get(peerId);
    const peerRole: PeerRole = peer?.info.role ?? "viewer";

    // Apply the update to a temporary doc first for validation
    const tempDoc = new Y.Doc();
    Y.applyUpdate(tempDoc, Y.encodeStateAsUpdate(this.doc));
    Y.applyUpdate(tempDoc, data);

    const tempBlocksMap = tempDoc.getMap<Record<string, unknown>>("blocks");
    const validation = this.validator.validateUpdate_fromDiff(
      this.doc,
      beforeIds,
      tempBlocksMap,
      peerId,
      peerRole,
    );

    tempDoc.destroy();

    if (!validation.valid) {
      // Send rejections
      for (const rej of validation.rejections) {
        this.send(ws, { type: "reject", blockId: rej.blockId, reason: rej.reason });
        this.emit({
          type: "block_rejected",
          blockId: rej.blockId,
          peerId,
          reason: rej.reason,
        });
      }
      return;
    }

    // Apply to the authoritative doc
    Y.applyUpdate(this.doc, data);

    // Relay to all other peers
    for (const [otherId, other] of this.peers) {
      if (otherId !== peerId && other.ws.readyState === WebSocket.OPEN) {
        this.send(other.ws, { type: "sync", data });
      }
    }
  }

  private handleAwareness(
    ws: WebSocket,
    peerId: string,
    data: Uint8Array,
  ): void {
    // Apply awareness update
    awarenessProtocol.applyAwarenessUpdate(this.presence.awareness, data, ws);

    // Relay to all other peers
    for (const [otherId, other] of this.peers) {
      if (otherId !== peerId && other.ws.readyState === WebSocket.OPEN) {
        this.send(other.ws, { type: "awareness", data });
      }
    }
  }

  private handleDisconnect(peerId: string): void {
    this.peers.delete(peerId);
    this.validator.resetRateLimit(peerId);

    // Notify remaining peers
    this.broadcastExcept(peerId, {
      type: "session",
      action: "leave",
      peerId,
    });

    this.emit({ type: "peer_left", peerId });
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  private send(ws: WebSocket, msg: Message): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encodeMessage(msg));
    }
  }

  private broadcast(msg: Message): void {
    const encoded = encodeMessage(msg);
    for (const [, peer] of this.peers) {
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(encoded);
      }
    }
  }

  private broadcastExcept(excludePeerId: string, msg: Message): void {
    const encoded = encodeMessage(msg);
    for (const [peerId, peer] of this.peers) {
      if (peerId !== excludePeerId && peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(encoded);
      }
    }
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
