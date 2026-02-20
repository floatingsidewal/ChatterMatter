/**
 * Integration tests for MasterSession + ClientSession over WebSocket.
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { MasterSession } from "../src/p2p/master.js";
import { ClientSession } from "../src/p2p/client.js";
import type { Block } from "../src/types.js";
import type { SessionEvent } from "../src/p2p/types.js";

// Helpers
function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let tmpDir: string;
let master: MasterSession | null = null;
let clients: ClientSession[] = [];

function setup(sidecarContent = ""): { docPath: string; port: number } {
  tmpDir = mkdtempSync(join(tmpdir(), "cm-p2p-test-"));
  const docPath = join(tmpDir, "test.md");
  writeFileSync(docPath, "# Test Document\n\nSome content.\n", "utf-8");

  if (sidecarContent) {
    writeFileSync(docPath + ".chatter", sidecarContent, "utf-8");
  }

  // Use a random high port to avoid conflicts
  const port = 10000 + Math.floor(Math.random() * 50000);
  return { docPath, port };
}

afterEach(async () => {
  for (const client of clients) {
    client.disconnect();
  }
  clients = [];

  if (master) {
    await master.stop();
    master = null;
  }

  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("MasterSession", () => {
  it("starts and stops cleanly", async () => {
    const { docPath, port } = setup();
    master = new MasterSession({
      sessionId: "test-session",
      masterName: "alice",
      documentPath: docPath,
      port,
      sidecar: true,
    });

    await master.start();
    const info = master.getInfo();
    expect(info.sessionId).toBe("test-session");
    expect(info.masterName).toBe("alice");
    expect(info.peerCount).toBe(0);

    await master.stop();
    master = null;
  });

  it("loads existing blocks from sidecar", async () => {
    const existingBlocks = `\`\`\`chattermatter
{
  "id": "preexisting",
  "type": "comment",
  "content": "Already here",
  "status": "open"
}
\`\`\`
`;
    const { docPath, port } = setup(existingBlocks);
    master = new MasterSession({
      sessionId: "test-session",
      masterName: "alice",
      documentPath: docPath,
      port,
      sidecar: true,
    });

    await master.start();
    expect(master.getBlocks()).toHaveLength(1);
    expect(master.getBlocks()[0].id).toBe("preexisting");
  });

  it("saves state to sidecar on stop", async () => {
    const { docPath, port } = setup();
    master = new MasterSession({
      sessionId: "test-session",
      masterName: "alice",
      documentPath: docPath,
      port,
      sidecar: true,
    });

    await master.start();

    // The master's doc is accessible — add a block via the Yjs doc
    const { setBlock } = await import("../src/p2p/sync.js");
    setBlock(master.doc, {
      id: "saved1",
      type: "comment",
      content: "Will be saved",
      status: "open",
    });

    await master.stop();
    master = null;

    const savedContent = await readFile(docPath + ".chatter", "utf-8");
    expect(savedContent).toContain("saved1");
    expect(savedContent).toContain("Will be saved");
  });
});

describe("ClientSession connection", () => {
  it("connects to master and receives initial state", async () => {
    const existingBlocks = `\`\`\`chattermatter
{
  "id": "initial1",
  "type": "comment",
  "content": "Initial block",
  "status": "open"
}
\`\`\`
`;
    const { docPath, port } = setup(existingBlocks);
    master = new MasterSession({
      sessionId: "test-session",
      masterName: "alice",
      documentPath: docPath,
      port,
      sidecar: true,
    });
    await master.start();

    const client = new ClientSession({
      url: `ws://localhost:${port}`,
      peerId: randomUUID(),
      name: "bob",
    });
    clients.push(client);

    const sessionInfo = await client.connect();
    expect(sessionInfo.sessionId).toBe("test-session");
    expect(sessionInfo.masterName).toBe("alice");

    // Give a moment for state sync
    await wait(100);

    const blocks = client.getBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("initial1");
  });

  it("master tracks connected peers", async () => {
    const { docPath, port } = setup();
    master = new MasterSession({
      sessionId: "test-session",
      masterName: "alice",
      documentPath: docPath,
      port,
      sidecar: true,
    });
    await master.start();

    const client = new ClientSession({
      url: `ws://localhost:${port}`,
      peerId: "peer-bob",
      name: "bob",
    });
    clients.push(client);

    await client.connect();
    await wait(50);

    const peers = master.getPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0].name).toBe("bob");
    expect(peers[0].peerId).toBe("peer-bob");
  });
});

describe("block sync between master and client", () => {
  it("client block addition syncs to master", async () => {
    const { docPath, port } = setup();
    master = new MasterSession({
      sessionId: "test-session",
      masterName: "alice",
      documentPath: docPath,
      port,
      sidecar: true,
    });
    await master.start();

    const client = new ClientSession({
      url: `ws://localhost:${port}`,
      peerId: randomUUID(),
      name: "bob",
    });
    clients.push(client);
    await client.connect();
    await wait(100);

    // Client adds a block
    const block: Block = {
      id: "from-client",
      type: "comment",
      content: "Comment from Bob",
      author: "bob",
      status: "open",
    };
    client.addBlock(block);

    // Wait for sync
    await wait(200);

    const masterBlocks = master.getBlocks();
    expect(masterBlocks.find((b) => b.id === "from-client")).toBeDefined();
  });

  it("syncs blocks between two clients via master", async () => {
    const { docPath, port } = setup();
    master = new MasterSession({
      sessionId: "test-session",
      masterName: "alice",
      documentPath: docPath,
      port,
      sidecar: true,
    });
    await master.start();

    const client1 = new ClientSession({
      url: `ws://localhost:${port}`,
      peerId: randomUUID(),
      name: "bob",
    });
    const client2 = new ClientSession({
      url: `ws://localhost:${port}`,
      peerId: randomUUID(),
      name: "charlie",
    });
    clients.push(client1, client2);

    await client1.connect();
    await client2.connect();
    await wait(100);

    // Client1 adds a block
    client1.addBlock({
      id: "c1-block",
      type: "comment",
      content: "From Bob",
      author: "bob",
      status: "open",
    });

    // Wait for sync through master to client2
    await wait(300);

    const client2Blocks = client2.getBlocks();
    expect(client2Blocks.find((b) => b.id === "c1-block")).toBeDefined();
  });
});

describe("session events", () => {
  it("master emits peer_joined and peer_left", async () => {
    const { docPath, port } = setup();
    master = new MasterSession({
      sessionId: "test-session",
      masterName: "alice",
      documentPath: docPath,
      port,
      sidecar: true,
    });

    const events: SessionEvent[] = [];
    master.onEvent((e) => events.push(e));

    await master.start();

    const client = new ClientSession({
      url: `ws://localhost:${port}`,
      peerId: "peer-bob",
      name: "bob",
    });
    clients.push(client);

    await client.connect();
    await wait(50);

    expect(events.some((e) => e.type === "peer_joined")).toBe(true);
    const joinEvent = events.find((e) => e.type === "peer_joined");
    if (joinEvent?.type === "peer_joined") {
      expect(joinEvent.peer.name).toBe("bob");
    }

    client.disconnect();
    clients = [];
    await wait(100);

    expect(events.some((e) => e.type === "peer_left")).toBe(true);
  });

  it("client receives session_ended when master stops", async () => {
    const { docPath, port } = setup();
    master = new MasterSession({
      sessionId: "test-session",
      masterName: "alice",
      documentPath: docPath,
      port,
      sidecar: true,
    });
    await master.start();

    const client = new ClientSession({
      url: `ws://localhost:${port}`,
      peerId: randomUUID(),
      name: "bob",
    });
    clients.push(client);

    const events: SessionEvent[] = [];
    client.onEvent((e) => events.push(e));

    await client.connect();
    await wait(50);

    await master.stop();
    master = null;
    await wait(100);

    expect(events.some((e) => e.type === "session_ended")).toBe(true);
  });
});
