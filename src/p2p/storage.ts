/**
 * Session persistence storage.
 *
 * Saves and restores P2P session state to disk, allowing sessions
 * to be resumed after interruption.
 *
 * Storage structure:
 * .chattermatter/sessions/<session-id>/
 * ├── meta.json     # SessionMeta
 * ├── state.crdt    # Yjs encodeStateAsUpdate binary
 * └── peers.json    # StoredPeer[]
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import * as Y from "yjs";
import type { PeerInfo, PeerRole } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMeta {
  sessionId: string;
  masterName: string;
  documentPath: string;
  port: number;
  createdAt: string;
  updatedAt: string;
  sidecar: boolean;
}

export interface StoredPeer {
  peerId: string;
  name: string;
  role: PeerRole;
  connectedAt: string;
}

export interface StoredSession {
  meta: SessionMeta;
  state: Uint8Array;
  peers: StoredPeer[];
}

// ---------------------------------------------------------------------------
// SessionStorage
// ---------------------------------------------------------------------------

const STORAGE_DIR = ".chattermatter/sessions";

export class SessionStorage {
  private baseDir: string;

  /**
   * Create a session storage instance.
   * @param documentPath - Path to the document being reviewed (used to determine storage location)
   */
  constructor(documentPath: string) {
    // Store sessions relative to the document's directory
    const docDir = dirname(documentPath);
    this.baseDir = join(docDir, STORAGE_DIR);
  }

  /**
   * Get the directory for a specific session.
   */
  private sessionDir(sessionId: string): string {
    return join(this.baseDir, sessionId);
  }

  /**
   * Ensure the session directory exists.
   */
  private ensureDir(sessionId: string): string {
    const dir = this.sessionDir(sessionId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Save session state to disk.
   */
  saveSession(
    sessionId: string,
    doc: Y.Doc,
    meta: Omit<SessionMeta, "updatedAt">,
    peers: PeerInfo[],
  ): void {
    const dir = this.ensureDir(sessionId);

    // Save metadata
    const fullMeta: SessionMeta = {
      ...meta,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(fullMeta, null, 2), "utf-8");

    // Save CRDT state
    const state = Y.encodeStateAsUpdate(doc);
    writeFileSync(join(dir, "state.crdt"), Buffer.from(state));

    // Save peer list
    const storedPeers: StoredPeer[] = peers.map((p) => ({
      peerId: p.peerId,
      name: p.name,
      role: p.role,
      connectedAt: p.connectedAt,
    }));
    writeFileSync(join(dir, "peers.json"), JSON.stringify(storedPeers, null, 2), "utf-8");
  }

  /**
   * Load a session from disk.
   * Returns null if the session doesn't exist.
   */
  loadSession(sessionId: string): StoredSession | null {
    const dir = this.sessionDir(sessionId);

    if (!existsSync(dir)) return null;

    const metaPath = join(dir, "meta.json");
    const statePath = join(dir, "state.crdt");
    const peersPath = join(dir, "peers.json");

    if (!existsSync(metaPath) || !existsSync(statePath)) {
      return null;
    }

    try {
      const meta: SessionMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
      const state = new Uint8Array(readFileSync(statePath));
      const peers: StoredPeer[] = existsSync(peersPath)
        ? JSON.parse(readFileSync(peersPath, "utf-8"))
        : [];

      return { meta, state, peers };
    } catch {
      return null;
    }
  }

  /**
   * List all saved sessions.
   */
  listSessions(): SessionMeta[] {
    if (!existsSync(this.baseDir)) {
      return [];
    }

    const sessions: SessionMeta[] = [];

    try {
      const entries = readdirSync(this.baseDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metaPath = join(this.baseDir, entry.name, "meta.json");
          if (existsSync(metaPath)) {
            try {
              const meta: SessionMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
              sessions.push(meta);
            } catch {
              // Skip invalid session directories
            }
          }
        }
      }
    } catch {
      return [];
    }

    // Sort by updatedAt, most recent first
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return sessions;
  }

  /**
   * Delete a session from disk.
   * Returns true if deleted, false if not found.
   */
  deleteSession(sessionId: string): boolean {
    const dir = this.sessionDir(sessionId);

    if (!existsSync(dir)) {
      return false;
    }

    rmSync(dir, { recursive: true });
    return true;
  }

  /**
   * Check if a session exists.
   */
  sessionExists(sessionId: string): boolean {
    const metaPath = join(this.sessionDir(sessionId), "meta.json");
    return existsSync(metaPath);
  }

  /**
   * Get the base storage directory path.
   */
  getBaseDir(): string {
    return this.baseDir;
  }
}
