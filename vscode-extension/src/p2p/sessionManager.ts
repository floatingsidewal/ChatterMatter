/**
 * SessionManager — wraps ClientSession/MasterSession and manages P2P lifecycle.
 *
 * Provides a unified API for hosting or joining sessions from the VS Code extension.
 */

import * as vscode from "vscode";
import { ulid } from "ulid";
import {
  ClientSession,
  MasterSession,
  type SessionConfig,
  type SessionInfo,
  type PeerInfo,
  type PeerRole,
  type SessionEvent,
  type DocumentContent,
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
    return this.documentContent;
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
   */
  addBlock(block: Block): void {
    if (this.client) {
      this.client.addBlock(block);
    }
    // Master writes directly to file, handled by existing comments.ts
  }

  /**
   * Update an existing block.
   */
  updateBlock(block: Block): void {
    if (this.client) {
      this.client.updateBlock(block);
    }
  }

  /**
   * Delete a block by ID.
   */
  deleteBlock(blockId: string): boolean {
    if (this.client) {
      return this.client.deleteBlock(blockId);
    }
    return false;
  }

  /**
   * Get the client's current role.
   */
  getRole(): PeerRole | null {
    if (this.master) {
      return "master";
    }
    if (this.client) {
      return this.client.getRole();
    }
    return null;
  }

  /**
   * Change a peer's role (master only).
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

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.leaveSession();
  }
}
