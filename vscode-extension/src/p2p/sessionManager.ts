/**
 * SessionManager — wraps ClientSession/MasterSession and manages P2P lifecycle.
 *
 * Provides a unified API for hosting or joining sessions from the VS Code extension.
 */

import * as vscode from "vscode";
import * as os from "node:os";
import { ulid } from "ulid";
import {
  ClientSession,
  MasterSession,
  SessionStorage,
  validateBlock,
  buildInviteUrl,
  type SessionConfig,
  type SessionInfo,
  type SessionMeta,
  type PeerInfo,
  type PeerRole,
  type SessionEvent,
  type DocumentContent,
  type InviteToken,
  type CreateTokenOptions,
} from "chattermatter";
import type { Block } from "chattermatter";

export type P2PSessionEvent =
  | SessionEvent
  | { type: "connected"; sessionInfo: SessionInfo }
  | { type: "disconnected" }
  | { type: "document_received"; document: DocumentContent };

export type P2PEventHandler = (event: P2PSessionEvent) => void;

export class SessionManager {
  private client: ClientSession | null = null;
  private master: MasterSession | null = null;
  private eventHandlers: P2PEventHandler[] = [];
  private sessionInfo: SessionInfo | null = null;
  private documentContent: DocumentContent | null = null;
  private cleanupHandlers: (() => void)[] = [];
  private currentUserName: string = "";
  private currentDocPath: string | null = null;
  private currentPort: number = 0;

  /**
   * Host a new review session.
   */
  async hostSession(
    docUri: vscode.Uri,
    port: number,
    name: string,
  ): Promise<SessionInfo> {
    if (this.isConnected()) {
      throw new Error("Already in a session. Leave the current session first.");
    }

    this.currentUserName = name;
    this.currentDocPath = docUri.fsPath;
    this.currentPort = port;

    const config: SessionConfig = {
      sessionId: ulid(),
      masterName: name,
      documentPath: docUri.fsPath,
      port,
      sidecar: true,
    };

    this.master = new MasterSession(config);

    // Subscribe to master events
    const cleanup = this.master.onEvent((event) => {
      this.emit(event);
    });
    this.cleanupHandlers.push(cleanup);

    await this.master.start();

    this.sessionInfo = this.master.getInfo();
    this.documentContent = this.master.getDocumentContent();

    this.emit({ type: "connected", sessionInfo: this.sessionInfo });

    return this.sessionInfo;
  }

  /**
   * Join an existing review session.
   */
  async joinSession(
    url: string,
    name: string,
    role: PeerRole = "reviewer",
  ): Promise<SessionInfo> {
    if (this.isConnected()) {
      throw new Error("Already in a session. Leave the current session first.");
    }

    this.currentUserName = name;

    this.client = new ClientSession({
      url,
      peerId: ulid(),
      name,
      role,
    });

    // Subscribe to client events
    const cleanup = this.client.onEvent((event) => {
      this.emit(event);

      // Check if we received document content after sync
      if (event.type === "peer_joined" || event.type === "block_added") {
        const doc = this.client?.getDocument();
        if (doc && !this.documentContent) {
          this.documentContent = doc;
          this.emit({ type: "document_received", document: doc });
        }
      }
    });
    this.cleanupHandlers.push(cleanup);

    this.sessionInfo = await this.client.connect();

    // Get document content after connection
    // Wait a small moment for doc_content message to arrive
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.documentContent = this.client.getDocument();

    this.emit({ type: "connected", sessionInfo: this.sessionInfo });

    if (this.documentContent) {
      this.emit({ type: "document_received", document: this.documentContent });
    }

    return this.sessionInfo;
  }

  /**
   * Leave the current session.
   */
  async leaveSession(): Promise<void> {
    // Cleanup event handlers
    for (const cleanup of this.cleanupHandlers) {
      cleanup();
    }
    this.cleanupHandlers = [];

    if (this.master) {
      await this.master.stop();
      this.master = null;
    }

    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    this.sessionInfo = null;
    this.documentContent = null;

    this.emit({ type: "disconnected" });
  }

  /**
   * Check if connected to a session.
   */
  isConnected(): boolean {
    return this.master !== null || this.client !== null;
  }

  /**
   * Check if hosting a session.
   */
  isHosting(): boolean {
    return this.master !== null;
  }

  /**
   * Get current session info.
   */
  getSessionInfo(): SessionInfo | null {
    if (this.master) {
      return this.master.getInfo();
    }
    return this.sessionInfo;
  }

  /**
   * Get connected peers.
   */
  getPeers(): PeerInfo[] {
    if (this.master) {
      return this.master.getPeers();
    }
    // Client doesn't track peers directly, just session info
    return [];
  }

  /**
   * Get the shared document content.
   */
  getDocument(): DocumentContent | null {
    if (this.master) {
      return this.master.getDocumentContent();
    }
    if (this.client) {
      // Always get the latest from the client (may have been updated)
      return this.client.getDocument();
    }
    return this.documentContent;
  }

  /**
   * Update the document content and broadcast to peers (host only).
   */
  updateDocument(markdown: string): void {
    if (this.master) {
      this.master.updateDocumentContent(markdown);
    }
  }

  /**
   * Get all current blocks.
   */
  getBlocks(): Block[] {
    if (this.master) {
      return this.master.getBlocks();
    }
    if (this.client) {
      return this.client.getBlocks();
    }
    return [];
  }

  /**
   * Add a new block (comment).
   * Returns false if the block fails validation.
   */
  addBlock(block: Block): boolean {
    // Validate the block before adding to CRDT
    const validation = validateBlock(block);
    if (!validation.valid) {
      const messages = validation.errors.map(e => `${e.field}: ${e.message}`).join("; ");
      console.error(`Block validation failed: ${messages}`);
      return false;
    }

    if (this.master) {
      // Add to CRDT so it syncs to peers (also saves to file via observer)
      this.master.addBlock(block);
    } else if (this.client) {
      this.client.addBlock(block);
    }
    return true;
  }

  /**
   * Update an existing block.
   */
  updateBlock(block: Block): void {
    if (this.master) {
      this.master.updateBlock(block);
    } else if (this.client) {
      this.client.updateBlock(block);
    }
  }

  /**
   * Delete a block by ID.
   */
  deleteBlock(blockId: string): boolean {
    if (this.master) {
      return this.master.deleteBlock(blockId);
    }
    if (this.client) {
      return this.client.deleteBlock(blockId);
    }
    return false;
  }

  /**
   * Delete all resolved threads (owner only).
   * Returns the number of blocks deleted.
   */
  deleteResolvedBlocks(): number {
    if (this.master) {
      return this.master.deleteResolvedBlocks();
    }
    // Clients cannot bulk delete
    return 0;
  }

  /**
   * Get the client's current role.
   */
  getRole(): PeerRole | null {
    if (this.master) {
      return "owner";
    }
    if (this.client) {
      return this.client.getRole();
    }
    return null;
  }

  /**
   * Get the current user's display name in the session.
   */
  getUserName(): string {
    return this.currentUserName;
  }

  /**
   * Change a peer's role (owner only).
   */
  changePeerRole(peerId: string, newRole: PeerRole): boolean {
    if (this.master) {
      return this.master.changePeerRole(peerId, newRole);
    }
    return false;
  }

  /**
   * Subscribe to session events.
   */
  onEvent(handler: P2PEventHandler): vscode.Disposable {
    this.eventHandlers.push(handler);
    return new vscode.Disposable(() => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    });
  }

  private emit(event: P2PSessionEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  // -------------------------------------------------------------------------
  // Token Management (host only)
  // -------------------------------------------------------------------------

  /**
   * Create a new invite token.
   * Returns the token or null if not hosting.
   */
  createInviteToken(options?: CreateTokenOptions): InviteToken | null {
    if (!this.master) return null;
    return this.master.createToken(options);
  }

  /**
   * Get the invite URL for a token using a specific host.
   * Returns the URL or null if not hosting.
   */
  getInviteUrl(tokenStr: string, host?: string): string | null {
    if (!this.master) return null;

    // Use provided host or fall back to first available
    const selectedHost = host || this.getAvailableHosts()[0] || "localhost";
    const baseUrl = `ws://${selectedHost}:${this.currentPort}`;
    return buildInviteUrl(baseUrl, tokenStr);
  }

  /**
   * Get all available host addresses for invite URLs.
   * Returns array of { name, address } for each network interface.
   */
  getAvailableHosts(): string[] {
    const hosts: string[] = [];
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === "IPv4" && !iface.internal) {
          hosts.push(iface.address);
        }
      }
    }

    // Add hostname as fallback
    const hostname = os.hostname();
    if (hostname && !hosts.includes(hostname)) {
      hosts.push(hostname);
    }

    return hosts;
  }

  /**
   * Get all tokens for the current session.
   */
  getTokens(): InviteToken[] {
    if (!this.master) return [];
    return this.master.getTokens();
  }

  /**
   * Revoke a token.
   * Returns true if the token was revoked.
   */
  revokeToken(tokenStr: string): boolean {
    if (!this.master) return false;
    return this.master.revokeToken(tokenStr);
  }

  /**
   * Delete a token entirely.
   */
  deleteToken(tokenStr: string): boolean {
    if (!this.master) return false;
    return this.master.deleteToken(tokenStr);
  }

  // -------------------------------------------------------------------------
  // Session Persistence
  // -------------------------------------------------------------------------

  /**
   * List saved sessions for the current document.
   * Returns empty array if no document is open or no sessions exist.
   */
  listSessions(docPath?: string): SessionMeta[] {
    const path = docPath || this.currentDocPath;
    if (!path) return [];

    const storage = new SessionStorage(path);
    return storage.listSessions();
  }

  /**
   * Resume a previously saved session.
   */
  async resumeSession(
    sessionId: string,
    docPath: string,
    port: number,
    name: string,
  ): Promise<SessionInfo> {
    if (this.isConnected()) {
      throw new Error("Already in a session. Leave the current session first.");
    }

    const storage = new SessionStorage(docPath);
    const stored = storage.loadSession(sessionId);
    if (!stored) {
      throw new Error("Session not found");
    }

    this.currentUserName = name;
    this.currentDocPath = docPath;
    this.currentPort = port;

    const config: SessionConfig = {
      sessionId: stored.meta.sessionId,
      masterName: name,
      documentPath: docPath,
      port,
      sidecar: stored.meta.sidecar,
      initialState: stored.state,
    };

    this.master = new MasterSession(config);

    // Subscribe to master events
    const cleanup = this.master.onEvent((event) => {
      this.emit(event);
    });
    this.cleanupHandlers.push(cleanup);

    await this.master.start();

    this.sessionInfo = this.master.getInfo();
    this.documentContent = this.master.getDocumentContent();

    this.emit({ type: "connected", sessionInfo: this.sessionInfo });

    return this.sessionInfo;
  }

  /**
   * Delete a saved session.
   */
  deleteSession(sessionId: string, docPath?: string): boolean {
    const path = docPath || this.currentDocPath;
    if (!path) return false;

    const storage = new SessionStorage(path);
    return storage.deleteSession(sessionId);
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.leaveSession();
  }
}
