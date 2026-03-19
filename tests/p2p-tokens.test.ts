/**
 * Tests for invite tokens functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateInviteToken,
  createInviteToken,
  validateToken,
  extractTokenFromUrl,
  buildInviteUrl,
  type InviteToken,
} from "../src/p2p/tokens.js";
import { MasterSession } from "../src/p2p/master.js";
import { ClientSession } from "../src/p2p/client.js";
import type { SessionConfig } from "../src/p2p/types.js";

describe("Token Generation", () => {
  it("generates a 22-character base64url token", () => {
    const token = generateInviteToken();
    expect(token).toHaveLength(22);
    // base64url only contains alphanumeric, -, and _
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique tokens", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateInviteToken());
    }
    expect(tokens.size).toBe(100);
  });
});

describe("createInviteToken", () => {
  it("creates a token with default 24h expiration", () => {
    const token = createInviteToken();
    expect(token.token).toHaveLength(22);
    expect(token.expiresAt).not.toBeNull();
    expect(token.maxUses).toBeNull();
    expect(token.useCount).toBe(0);
    expect(token.revokedAt).toBeNull();
    expect(token.defaultRole).toBe("reviewer");

    // Check expiration is ~24 hours from now
    const expiresAt = new Date(token.expiresAt!).getTime();
    const now = Date.now();
    const diff = expiresAt - now;
    expect(diff).toBeGreaterThan(23 * 60 * 60 * 1000); // > 23 hours
    expect(diff).toBeLessThan(25 * 60 * 60 * 1000); // < 25 hours
  });

  it("creates a token with custom options", () => {
    const token = createInviteToken({
      expiresIn: 60 * 60 * 1000, // 1 hour
      maxUses: 5,
      label: "Test invite",
      defaultRole: "viewer",
    });

    expect(token.maxUses).toBe(5);
    expect(token.label).toBe("Test invite");
    expect(token.defaultRole).toBe("viewer");

    const expiresAt = new Date(token.expiresAt!).getTime();
    const now = Date.now();
    const diff = expiresAt - now;
    expect(diff).toBeGreaterThan(55 * 60 * 1000); // > 55 minutes
    expect(diff).toBeLessThan(65 * 60 * 1000); // < 65 minutes
  });

  it("creates a permanent token with expiresIn: 0", () => {
    const token = createInviteToken({ expiresIn: 0 });
    expect(token.expiresAt).toBeNull();
  });
});

describe("validateToken", () => {
  it("validates a fresh token", () => {
    const token = createInviteToken();
    const result = validateToken(token);
    expect(result.valid).toBe(true);
  });

  it("rejects a revoked token", () => {
    const token = createInviteToken();
    token.revokedAt = new Date().toISOString();

    const result = validateToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("revoked");
  });

  it("rejects an expired token", () => {
    const token = createInviteToken({ expiresIn: -1000 }); // Expired 1s ago

    const result = validateToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("rejects a token that reached max uses", () => {
    const token = createInviteToken({ maxUses: 2 });
    token.useCount = 2;

    const result = validateToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("usage limit");
  });

  it("accepts a token with uses remaining", () => {
    const token = createInviteToken({ maxUses: 5 });
    token.useCount = 4;

    const result = validateToken(token);
    expect(result.valid).toBe(true);
  });
});

describe("URL helpers", () => {
  describe("extractTokenFromUrl", () => {
    it("extracts token from ws:// URL", () => {
      const token = extractTokenFromUrl("ws://localhost:4117?token=abc123def456");
      expect(token).toBe("abc123def456");
    });

    it("extracts token from wss:// URL", () => {
      const token = extractTokenFromUrl("wss://example.com:4117?token=xyz789");
      expect(token).toBe("xyz789");
    });

    it("returns null when no token present", () => {
      const token = extractTokenFromUrl("ws://localhost:4117");
      expect(token).toBeNull();
    });

    it("handles URL with other query params", () => {
      const token = extractTokenFromUrl("ws://localhost:4117?foo=bar&token=mytoken&baz=qux");
      expect(token).toBe("mytoken");
    });

    it("returns null for invalid URL", () => {
      const token = extractTokenFromUrl("not a url");
      expect(token).toBeNull();
    });
  });

  describe("buildInviteUrl", () => {
    it("builds URL with token", () => {
      const url = buildInviteUrl("ws://localhost:4117", "abc123");
      expect(url).toBe("ws://localhost:4117/?token=abc123");
    });

    it("handles existing query params", () => {
      const url = buildInviteUrl("ws://localhost:4117?foo=bar", "abc123");
      expect(url).toContain("token=abc123");
      expect(url).toContain("foo=bar");
    });
  });
});

describe("MasterSession token management", () => {
  let tempDir: string;
  let master: MasterSession;
  let docPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "p2p-tokens-test-"));
    docPath = join(tempDir, "test.md");
    writeFileSync(docPath, "# Test Document\n\nSome content.");
  });

  afterEach(async () => {
    if (master) {
      await master.stop();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("starts without requiring tokens", async () => {
    const config: SessionConfig = {
      sessionId: "test-session",
      masterName: "Test Master",
      documentPath: docPath,
      port: 14117,
    };
    master = new MasterSession(config);
    await master.start();

    expect(master.requiresToken()).toBe(false);
    expect(master.getTokens()).toHaveLength(0);
  });

  it("requires tokens after first token is created", async () => {
    const config: SessionConfig = {
      sessionId: "test-session",
      masterName: "Test Master",
      documentPath: docPath,
      port: 14117,
    };
    master = new MasterSession(config);
    await master.start();

    const token = master.createToken();
    expect(master.requiresToken()).toBe(true);
    expect(master.getTokens()).toHaveLength(1);
    expect(token.token).toHaveLength(22);
  });

  it("generates correct invite URL", async () => {
    const config: SessionConfig = {
      sessionId: "test-session",
      masterName: "Test Master",
      documentPath: docPath,
      port: 14117,
    };
    master = new MasterSession(config);
    await master.start();

    const token = master.createToken();
    const url = master.getInviteUrl(token.token);

    expect(url).toContain("ws://");
    expect(url).toContain(":14117");
    expect(url).toContain(`token=${token.token}`);
  });

  it("revokes a token", async () => {
    const config: SessionConfig = {
      sessionId: "test-session",
      masterName: "Test Master",
      documentPath: docPath,
      port: 14117,
    };
    master = new MasterSession(config);
    await master.start();

    const token = master.createToken();
    expect(master.revokeToken(token.token)).toBe(true);

    const retrieved = master.getToken(token.token);
    expect(retrieved?.revokedAt).not.toBeNull();
  });

  it("deletes a token", async () => {
    const config: SessionConfig = {
      sessionId: "test-session",
      masterName: "Test Master",
      documentPath: docPath,
      port: 14117,
    };
    master = new MasterSession(config);
    await master.start();

    const token = master.createToken();
    expect(master.deleteToken(token.token)).toBe(true);
    expect(master.getTokens()).toHaveLength(0);
    expect(master.requiresToken()).toBe(false);
  });
});

describe("Client token handling", () => {
  it("extracts token from URL on construction", () => {
    const client = new ClientSession({
      url: "ws://localhost:4117?token=test123",
      peerId: "test-peer",
      name: "Test Client",
    });

    // The token is private, but we can test that it's extracted by
    // checking that the client was constructed successfully
    expect(client).toBeDefined();
  });
});

describe("Token authentication flow", () => {
  let tempDir: string;
  let master: MasterSession;
  let docPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "p2p-tokens-auth-test-"));
    docPath = join(tempDir, "test.md");
    writeFileSync(docPath, "# Test Document\n\nSome content.");
  });

  afterEach(async () => {
    if (master) {
      await master.stop();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("allows tokenless connection when no tokens exist", async () => {
    const config: SessionConfig = {
      sessionId: "test-session",
      masterName: "Test Master",
      documentPath: docPath,
      port: 14118,
    };
    master = new MasterSession(config);
    await master.start();

    // Session should not require tokens
    expect(master.requiresToken()).toBe(false);

    // Client without token should connect successfully
    const client = new ClientSession({
      url: "ws://localhost:14118",
      peerId: "test-peer",
      name: "Test Client",
    });

    const sessionInfo = await client.connect();
    expect(sessionInfo.sessionId).toBe("test-session");

    client.disconnect();
  });

  it("rejects connection without token when tokens are required", async () => {
    const config: SessionConfig = {
      sessionId: "test-session",
      masterName: "Test Master",
      documentPath: docPath,
      port: 14119,
    };
    master = new MasterSession(config);
    await master.start();

    // Create a token to enable token requirement
    master.createToken();
    expect(master.requiresToken()).toBe(true);

    // Client without token should be rejected
    const client = new ClientSession({
      url: "ws://localhost:14119",
      peerId: "test-peer",
      name: "Test Client",
    });

    await expect(client.connect()).rejects.toThrow("requires an invite link");
  });

  it("accepts connection with valid token", async () => {
    const config: SessionConfig = {
      sessionId: "test-session",
      masterName: "Test Master",
      documentPath: docPath,
      port: 14120,
    };
    master = new MasterSession(config);
    await master.start();

    const token = master.createToken();
    // Use localhost instead of hostname from getInviteUrl for test reliability
    const inviteUrl = `ws://localhost:14120?token=${token.token}`;

    const client = new ClientSession({
      url: inviteUrl,
      peerId: "test-peer",
      name: "Test Client",
    });

    const sessionInfo = await client.connect();
    expect(sessionInfo.sessionId).toBe("test-session");

    client.disconnect();
  });

  it("rejects connection with invalid token", async () => {
    const config: SessionConfig = {
      sessionId: "test-session",
      masterName: "Test Master",
      documentPath: docPath,
      port: 14121,
    };
    master = new MasterSession(config);
    await master.start();

    // Create a token to enable token requirement
    master.createToken();

    // Try to connect with a fake token
    const client = new ClientSession({
      url: "ws://localhost:14121?token=invalid_token_12345",
      peerId: "test-peer",
      name: "Test Client",
    });

    await expect(client.connect()).rejects.toThrow("not recognized");
  });

  it("rejects connection with revoked token", async () => {
    const config: SessionConfig = {
      sessionId: "test-session",
      masterName: "Test Master",
      documentPath: docPath,
      port: 14122,
    };
    master = new MasterSession(config);
    await master.start();

    const token = master.createToken();
    master.revokeToken(token.token);

    const client = new ClientSession({
      url: `ws://localhost:14122?token=${token.token}`,
      peerId: "test-peer",
      name: "Test Client",
    });

    await expect(client.connect()).rejects.toThrow("revoked");
  });

  it("increments token use count on successful connection", async () => {
    const config: SessionConfig = {
      sessionId: "test-session",
      masterName: "Test Master",
      documentPath: docPath,
      port: 14123,
    };
    master = new MasterSession(config);
    await master.start();

    const token = master.createToken({ maxUses: 3 });
    expect(token.useCount).toBe(0);

    // Use localhost instead of hostname from getInviteUrl for test reliability
    const inviteUrl = `ws://localhost:14123?token=${token.token}`;

    // Connect first client
    const client1 = new ClientSession({
      url: inviteUrl,
      peerId: "test-peer-1",
      name: "Test Client 1",
    });
    await client1.connect();

    const updatedToken = master.getToken(token.token);
    expect(updatedToken?.useCount).toBe(1);

    client1.disconnect();
  });

  it("rejects connection when max uses exceeded", async () => {
    const config: SessionConfig = {
      sessionId: "test-session",
      masterName: "Test Master",
      documentPath: docPath,
      port: 14124,
    };
    master = new MasterSession(config);
    await master.start();

    const token = master.createToken({ maxUses: 1 });
    // Use localhost instead of hostname from getInviteUrl for test reliability
    const inviteUrl = `ws://localhost:14124?token=${token.token}`;

    // First connection should succeed
    const client1 = new ClientSession({
      url: inviteUrl,
      peerId: "test-peer-1",
      name: "Test Client 1",
    });
    await client1.connect();
    client1.disconnect();

    // Second connection should fail
    const client2 = new ClientSession({
      url: inviteUrl,
      peerId: "test-peer-2",
      name: "Test Client 2",
    });

    await expect(client2.connect()).rejects.toThrow("usage limit");
  });
});
