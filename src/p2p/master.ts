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
import * as os from "node:os";
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
import { createDoc, createEmptyDoc, getBlocksMap, getBlocks, materialize, observeBlocks, deleteBlockWithChildren, deleteResolvedBlocks as syncDeleteResolvedBlocks } from "./sync.js";
import { MasterValidator } from "./validation.js";
import { PresenceManager } from "./presence.js";
import { encodeMessage, decodeMessage } from "./protocol.js";
import { SessionStorage } from "./storage.js";
import {
  createInviteToken,
  validateToken,
  buildInviteUrl,
  type InviteToken,
  type CreateTokenOptions,
} from "./tokens.js";
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

/**
 * Get the local network IP address (first non-internal IPv4 address).
 * Returns null if no suitable address is found.
 */
function getLocalIpAddress(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

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
  private pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private tokens = new Map<string, InviteToken>();
  private port: number;

  constructor(private config: SessionConfig) {
    this.sessionId = config.sessionId || ulid();
    this.documentPath = config.documentPath;
    this.sidecar = config.sidecar ?? true;
    this.createdAt = new Date().toISOString();
    this.autoSaveInterval = config.autoSaveInterval ?? DEFAULT_AUTO_SAVE_INTERVAL;
    this.port = config.port;

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

    // Load tokens if resuming
    if (config.initialState) {
      const storedTokens = this.storage.loadTokens(this.sessionId);
      for (const token of storedTokens) {
        this.tokens.set(token.token, token);
      }
    }

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

  /**
   * Update the document content and broadcast to all peers.
   * Called when the host edits the markdown file.
   */
  updateDocumentContent(markdown: string): void {
    if (this.documentContent) {
      this.documentContent.markdown = markdown;
      // Broadcast updated content to all peers
      this.broadcast({
        type: "doc_content",
        markdown: this.documentContent.markdown,
        path: this.documentContent.path,
      });
    }
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
        // Debounced save to reduce I/O (50ms delay)
        this.debouncedSave();

        // Emit events immediately so UI updates quickly
        for (const change of changes) {
          if (change.action === "add") {
            this.emit({ type: "block_added", blockId: change.blockId, peerId: "master" });
          } else if (change.action === "update") {
            this.emit({ type: "block_updated", blockId: change.blockId, peerId: "master" });
          } else if (change.action === "delete") {
            this.emit({ type: "block_deleted", blockId: change.blockId, peerId: "master" });
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

    // Flush any pending debounced save
    if (this.pendingSaveTimer) {
      clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = null;
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
   * Add a block to the CRDT (for local additions that should sync to peers).
   */
  addBlock(block: Block): void {
    // Capture state before
    const beforeState = Y.encodeStateVector(this.doc);

    const blocksMap = getBlocksMap(this.doc);
    blocksMap.set(block.id, block as unknown as Record<string, unknown>);

    // Get the update and broadcast to all peers
    const update = Y.encodeStateAsUpdate(this.doc, beforeState);
    this.broadcastSync(update);
  }

  /**
   * Update a block in the CRDT.
   */
  updateBlock(block: Block): void {
    this.addBlock(block);
  }

  /**
   * Delete a block and all its children from the CRDT.
   */
  deleteBlock(blockId: string): boolean {
    const blocksMap = getBlocksMap(this.doc);
    if (!blocksMap.has(blockId)) {
      return false;
    }

    // Capture state before
    const beforeState = Y.encodeStateVector(this.doc);

    // Delete the block and all its children
    const deleted = deleteBlockWithChildren(this.doc, blockId);

    if (deleted.length === 0) {
      return false;
    }

    // Get the update and broadcast to all peers
    const update = Y.encodeStateAsUpdate(this.doc, beforeState);
    this.broadcastSync(update);

    return true;
  }

  /**
   * Delete all resolved threads (and their children) from the CRDT.
   * Returns the number of blocks deleted.
   */
  deleteResolvedBlocks(): number {
    // Capture state before
    const beforeState = Y.encodeStateVector(this.doc);

    const deleted = syncDeleteResolvedBlocks(this.doc);

    if (deleted.length > 0) {
      // Get the update and broadcast to all peers
      const update = Y.encodeStateAsUpdate(this.doc, beforeState);
      this.broadcastSync(update);
    }

    return deleted.length;
  }

  /**
   * Broadcast a sync update to all connected peers.
   */
  private broadcastSync(update: Uint8Array): void {
    const msg: Message = { type: "sync", data: update };
    this.broadcast(msg);
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
   * Change a peer's role. Only owners can change roles.
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
  // Token Management
  // -------------------------------------------------------------------------

  /**
   * Check if the session requires tokens for authentication.
   * Returns true if any tokens have been created.
   */
  requiresToken(): boolean {
    return this.tokens.size > 0;
  }

  /**
   * Create a new invite token.
   * Returns the created token.
   */
  createToken(options?: CreateTokenOptions): InviteToken {
    const token = createInviteToken(options);
    this.tokens.set(token.token, token);
    this.saveTokens();
    return token;
  }

  /**
   * Get all tokens (for management UI).
   */
  getTokens(): InviteToken[] {
    return Array.from(this.tokens.values());
  }

  /**
   * Get a specific token by its string value.
   */
  getToken(tokenStr: string): InviteToken | undefined {
    return this.tokens.get(tokenStr);
  }

  /**
   * Revoke a token by its string value.
   * Returns true if the token was found and revoked.
   */
  revokeToken(tokenStr: string): boolean {
    const token = this.tokens.get(tokenStr);
    if (!token) return false;

    token.revokedAt = new Date().toISOString();
    this.saveTokens();
    return true;
  }

  /**
   * Delete a token entirely.
   * Returns true if the token was found and deleted.
   */
  deleteToken(tokenStr: string): boolean {
    const deleted = this.tokens.delete(tokenStr);
    if (deleted) {
      this.saveTokens();
    }
    return deleted;
  }

  /**
   * Increment the use count for a token.
   * Called after successful authentication.
   */
  private incrementTokenUse(tokenStr: string): void {
    const token = this.tokens.get(tokenStr);
    if (token) {
      token.useCount++;
      this.saveTokens();
    }
  }

  /**
   * Get an invite URL for a specific token.
   * Uses the local network IP address for better connectivity.
   */
  getInviteUrl(tokenStr: string): string {
    const host = getLocalIpAddress() || os.hostname();
    const baseUrl = `ws://${host}:${this.port}`;
    return buildInviteUrl(baseUrl, tokenStr);
  }

  /**
   * Save tokens to disk.
   */
  private saveTokens(): void {
    this.storage.saveTokens(this.sessionId, Array.from(this.tokens.values()));
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
   * Debounced save to reduce I/O overhead during rapid changes.
   */
  private debouncedSave(): void {
    if (this.pendingSaveTimer) {
      clearTimeout(this.pendingSaveTimer);
    }
    this.pendingSaveTimer = setTimeout(() => {
      this.save();
      this.pendingSaveTimer = null;
    }, 50);
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
      Array.from(this.tokens.values()),
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
            if (peerId === null) {
              // Auth rejected, connection will be closed
              return;
            }
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

  private handleAuth(ws: WebSocket, msg: Message & { type: "auth" }): string | null {
    // Validate token if session requires it
    if (this.requiresToken()) {
      if (!msg.token) {
        this.send(ws, { type: "auth_rejected", reason: "This session requires an invite link" });
        ws.close(4003, "Token required");
        return null;
      }

      const token = this.tokens.get(msg.token);
      if (!token) {
        this.send(ws, { type: "auth_rejected", reason: "Invite link not recognized" });
        ws.close(4003, "Invalid token");
        return null;
      }

      const validation = validateToken(token);
      if (!validation.valid) {
        this.send(ws, { type: "auth_rejected", reason: validation.reason! });
        ws.close(4003, validation.reason);
        return null;
      }

      // Token is valid - increment use count
      this.incrementTokenUse(msg.token);
    }

    const peerId = msg.peerId;

    // Determine role: use token's default role if available, otherwise use requested role
    let role: PeerRole = msg.role ?? "reviewer";
    if (msg.token) {
      const token = this.tokens.get(msg.token);
      if (token) {
        role = token.defaultRole;
      }
    }

    const peerInfo: PeerInfo = {
      peerId,
      name: msg.name,
      role,
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
