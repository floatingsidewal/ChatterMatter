/**
 * Tests for session persistence storage.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStorage } from "../src/p2p/storage.js";
import { createDoc, setBlock, getBlocks } from "../src/p2p/sync.js";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as Y from "yjs";
import type { Block } from "../src/types.js";
import type { PeerInfo } from "../src/p2p/types.js";

describe("SessionStorage", () => {
  let tempDir: string;
  let docPath: string;
  let storage: SessionStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "chattermatter-storage-test-"));
    docPath = join(tempDir, "test.md");
    writeFileSync(docPath, "# Test Document\n", "utf-8");
    storage = new SessionStorage(docPath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe("saveSession and loadSession", () => {
    it("saves and loads a session", () => {
      const sessionId = "test-session-1";
      const doc = createDoc("");

      // Add a block
      const block: Block = {
        id: "block1",
        type: "comment",
        content: "Test comment",
        status: "open",
      };
      setBlock(doc, block);

      const peers: PeerInfo[] = [
        {
          peerId: "peer1",
          name: "bob",
          role: "reviewer",
          connectedAt: "2024-01-01T00:00:00Z",
        },
      ];

      // Save
      storage.saveSession(sessionId, doc, {
        sessionId,
        masterName: "alice",
        documentPath: docPath,
        port: 4117,
        createdAt: "2024-01-01T00:00:00Z",
        sidecar: true,
      }, peers);

      // Load
      const stored = storage.loadSession(sessionId);

      expect(stored).not.toBeNull();
      expect(stored!.meta.sessionId).toBe(sessionId);
      expect(stored!.meta.masterName).toBe("alice");
      expect(stored!.meta.port).toBe(4117);
      expect(stored!.meta.sidecar).toBe(true);
      expect(stored!.meta.updatedAt).toBeDefined();
      expect(stored!.peers).toHaveLength(1);
      expect(stored!.peers[0].name).toBe("bob");

      // Verify CRDT state can be restored
      const restoredDoc = new Y.Doc();
      Y.applyUpdate(restoredDoc, stored!.state);
      const restoredBlocks = getBlocks(restoredDoc);
      expect(restoredBlocks).toHaveLength(1);
      expect(restoredBlocks[0].id).toBe("block1");
      expect(restoredBlocks[0].content).toBe("Test comment");

      doc.destroy();
      restoredDoc.destroy();
    });

    it("returns null for non-existent session", () => {
      const stored = storage.loadSession("nonexistent");
      expect(stored).toBeNull();
    });

    it("overwrites existing session on save", () => {
      const sessionId = "test-session-2";
      const doc = createDoc("");

      // First save
      const block1: Block = { id: "b1", type: "comment", content: "First", status: "open" };
      setBlock(doc, block1);
      storage.saveSession(sessionId, doc, {
        sessionId,
        masterName: "alice",
        documentPath: docPath,
        port: 4117,
        createdAt: "2024-01-01T00:00:00Z",
        sidecar: true,
      }, []);

      // Second save with different content
      const block2: Block = { id: "b2", type: "comment", content: "Second", status: "open" };
      setBlock(doc, block2);
      storage.saveSession(sessionId, doc, {
        sessionId,
        masterName: "alice",
        documentPath: docPath,
        port: 4117,
        createdAt: "2024-01-01T00:00:00Z",
        sidecar: true,
      }, []);

      const stored = storage.loadSession(sessionId);
      expect(stored).not.toBeNull();

      const restoredDoc = new Y.Doc();
      Y.applyUpdate(restoredDoc, stored!.state);
      const restoredBlocks = getBlocks(restoredDoc);
      expect(restoredBlocks).toHaveLength(2);

      doc.destroy();
      restoredDoc.destroy();
    });
  });

  describe("listSessions", () => {
    it("returns empty array when no sessions", () => {
      const sessions = storage.listSessions();
      expect(sessions).toEqual([]);
    });

    it("lists all saved sessions", () => {
      const doc = createDoc("");

      // Save multiple sessions
      storage.saveSession("session1", doc, {
        sessionId: "session1",
        masterName: "alice",
        documentPath: docPath,
        port: 4117,
        createdAt: "2024-01-01T00:00:00Z",
        sidecar: true,
      }, []);

      storage.saveSession("session2", doc, {
        sessionId: "session2",
        masterName: "bob",
        documentPath: docPath,
        port: 4118,
        createdAt: "2024-01-02T00:00:00Z",
        sidecar: false,
      }, []);

      const sessions = storage.listSessions();
      expect(sessions).toHaveLength(2);

      // Should be sorted by updatedAt (most recent first)
      const ids = sessions.map((s) => s.sessionId);
      expect(ids).toContain("session1");
      expect(ids).toContain("session2");

      doc.destroy();
    });
  });

  describe("deleteSession", () => {
    it("deletes an existing session", () => {
      const sessionId = "session-to-delete";
      const doc = createDoc("");

      storage.saveSession(sessionId, doc, {
        sessionId,
        masterName: "alice",
        documentPath: docPath,
        port: 4117,
        createdAt: "2024-01-01T00:00:00Z",
        sidecar: true,
      }, []);

      expect(storage.sessionExists(sessionId)).toBe(true);

      const result = storage.deleteSession(sessionId);
      expect(result).toBe(true);
      expect(storage.sessionExists(sessionId)).toBe(false);
      expect(storage.loadSession(sessionId)).toBeNull();

      doc.destroy();
    });

    it("returns false for non-existent session", () => {
      const result = storage.deleteSession("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("sessionExists", () => {
    it("returns true for existing session", () => {
      const sessionId = "existing-session";
      const doc = createDoc("");

      storage.saveSession(sessionId, doc, {
        sessionId,
        masterName: "alice",
        documentPath: docPath,
        port: 4117,
        createdAt: "2024-01-01T00:00:00Z",
        sidecar: true,
      }, []);

      expect(storage.sessionExists(sessionId)).toBe(true);
      doc.destroy();
    });

    it("returns false for non-existent session", () => {
      expect(storage.sessionExists("nonexistent")).toBe(false);
    });
  });

  describe("getBaseDir", () => {
    it("returns the storage directory path", () => {
      const baseDir = storage.getBaseDir();
      expect(baseDir).toContain(".chattermatter");
      expect(baseDir).toContain("sessions");
    });
  });
});
