/**
 * CLI commands for P2P review sessions.
 *
 * chattermatter session host  — host a review session
 * chattermatter session join  — join a remote session
 * chattermatter session peers — list connected peers
 */

import type { Command } from "commander";
import { resolve } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ulid } from "ulid";
import { MasterSession } from "../p2p/master.js";
import { ClientSession } from "../p2p/client.js";
import { SessionStorage } from "../p2p/storage.js";
import type { Block, BlockType } from "../types.js";
import { BLOCK_TYPES } from "../types.js";
import type { PeerRole } from "../p2p/types.js";

export function registerSessionCommands(program: Command): void {
  const session = program
    .command("session")
    .description("Collaborative review sessions (P2P)");

  // -------------------------------------------------------------------------
  // chattermatter session host
  // -------------------------------------------------------------------------
  session
    .command("host")
    .description("Host a collaborative review session")
    .argument("<file>", "Markdown file to review")
    .requiredOption("-n, --name <name>", "Your display name")
    .option("-p, --port <port>", "WebSocket server port", "4117")
    .option("--sidecar", "Use sidecar mode", true)
    .action(async (file: string, opts) => {
      const filePath = resolve(file);
      const port = parseInt(opts.port, 10);
      const sessionId = ulid();

      const master = new MasterSession({
        sessionId,
        masterName: opts.name,
        documentPath: filePath,
        port,
        sidecar: opts.sidecar,
      });

      master.onEvent((event) => {
        switch (event.type) {
          case "peer_joined":
            console.log(`[+] ${event.peer.name} joined as ${event.peer.role} (${event.peer.peerId.slice(0, 8)}...)`);
            break;
          case "peer_left":
            console.log(`[-] Peer ${event.peerId.slice(0, 8)}... left`);
            break;
          case "block_added":
            console.log(`[block] Added ${event.blockId.slice(0, 8)}... by ${event.peerId.slice(0, 8)}...`);
            break;
          case "block_rejected":
            console.log(`[reject] Block ${event.blockId.slice(0, 8)}... from ${event.peerId.slice(0, 8)}...: ${event.reason}`);
            break;
          case "role_changed":
            console.log(`[role] ${event.peerId.slice(0, 8)}... changed from ${event.oldRole} to ${event.newRole}`);
            break;
          case "error":
            console.error(`[error] ${event.message}`);
            break;
        }
      });

      await master.start();

      const info = master.getInfo();
      console.log(`Session hosted: ${info.sessionId}`);
      console.log(`Document: ${filePath}`);
      console.log(`Listening on ws://localhost:${port}`);
      console.log(`Blocks loaded: ${master.getBlocks().length}`);
      console.log();
      console.log("Peers can join with:");
      console.log(`  chattermatter session join ws://localhost:${port} -n <name>`);
      console.log();
      console.log("Commands: (type and press Enter)");
      console.log("  peers          — list connected peers");
      console.log("  blocks         — list current blocks");
      console.log("  save           — save current state to disk");
      console.log("  promote <name> — promote peer to reviewer");
      console.log("  demote <name>  — demote peer to viewer");
      console.log("  quit           — end session and save");
      console.log();

      // Interactive command loop
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "session> ",
      });

      rl.prompt();

      rl.on("line", async (line: string) => {
        const trimmed = line.trim();
        const [cmd, ...args] = trimmed.split(/\s+/);
        const cmdLower = cmd?.toLowerCase() ?? "";

        switch (cmdLower) {
          case "peers": {
            const peers = master.getPeers();
            if (peers.length === 0) {
              console.log("No peers connected.");
            } else {
              for (const peer of peers) {
                console.log(`  ${peer.name} (${peer.peerId.slice(0, 8)}...) — ${peer.role} — since ${peer.connectedAt}`);
              }
            }
            break;
          }
          case "blocks": {
            const blocks = master.getBlocks();
            if (blocks.length === 0) {
              console.log("No blocks.");
            } else {
              for (const block of blocks) {
                const id = block.id.length > 8 ? block.id.slice(0, 8) + "..." : block.id;
                const status = block.status === "resolved" ? "[resolved]" : "[open]";
                console.log(`  ${status} ${block.type} ${id} — ${block.content.slice(0, 80)}`);
              }
            }
            break;
          }
          case "save":
            master.save();
            master.saveSession();
            console.log("State saved to disk.");
            break;
          case "promote": {
            const name = args.join(" ");
            if (!name) {
              console.log("Usage: promote <name>");
              break;
            }
            const peer = master.findPeerByName(name);
            if (!peer) {
              console.log(`Peer not found: ${name}`);
              break;
            }
            if (peer.role === "reviewer") {
              console.log(`${name} is already a reviewer.`);
              break;
            }
            master.changePeerRole(peer.peerId, "reviewer");
            console.log(`Promoted ${name} to reviewer.`);
            break;
          }
          case "demote": {
            const name = args.join(" ");
            if (!name) {
              console.log("Usage: demote <name>");
              break;
            }
            const peer = master.findPeerByName(name);
            if (!peer) {
              console.log(`Peer not found: ${name}`);
              break;
            }
            if (peer.role === "viewer") {
              console.log(`${name} is already a viewer.`);
              break;
            }
            master.changePeerRole(peer.peerId, "viewer");
            console.log(`Demoted ${name} to viewer.`);
            break;
          }
          case "quit":
          case "exit":
          case "q":
            console.log("Ending session...");
            await master.stop();
            console.log("Session ended. State saved.");
            rl.close();
            process.exit(0);
            break;
          case "":
            break;
          default:
            console.log(`Unknown command: ${cmdLower}`);
            break;
        }

        rl.prompt();
      });

      rl.on("close", async () => {
        await master.stop();
        process.exit(0);
      });

      // Handle Ctrl+C
      process.on("SIGINT", async () => {
        console.log("\nEnding session...");
        await master.stop();
        console.log("Session ended. State saved.");
        process.exit(0);
      });
    });

  // -------------------------------------------------------------------------
  // chattermatter session join
  // -------------------------------------------------------------------------
  session
    .command("join")
    .description("Join a remote review session")
    .argument("<url>", "WebSocket URL of the master (e.g. ws://localhost:4117)")
    .requiredOption("-n, --name <name>", "Your display name")
    .option("-r, --role <role>", "Role (reviewer or viewer)", "reviewer")
    .option("-o, --output <file>", "Local .chatter file to save state on exit")
    .action(async (url: string, opts) => {
      const peerId = randomUUID();
      const role: PeerRole = opts.role === "viewer" ? "viewer" : "reviewer";

      const client = new ClientSession({
        url,
        peerId,
        name: opts.name,
        role,
      });

      client.onEvent((event) => {
        switch (event.type) {
          case "peer_joined":
            console.log(`[+] ${event.peer.name} joined`);
            break;
          case "peer_left":
            console.log(`[-] Peer ${event.peerId.slice(0, 8)}... left`);
            break;
          case "block_rejected":
            console.log(`[reject] Block ${event.blockId.slice(0, 8)}...: ${event.reason}`);
            break;
          case "role_changed":
            if (event.peerId === peerId) {
              console.log(`[role] Your role changed from ${event.oldRole} to ${event.newRole}`);
            } else {
              console.log(`[role] ${event.peerId.slice(0, 8)}... changed to ${event.newRole}`);
            }
            break;
          case "session_ended":
            console.log("[!] Session ended by master.");
            break;
          case "error":
            console.error(`[error] ${event.message}`);
            break;
        }
      });

      console.log(`Connecting to ${url} as "${opts.name}"...`);

      try {
        const sessionInfo = await client.connect();
        console.log(`Connected to session: ${sessionInfo.sessionId}`);
        console.log(`Master: ${sessionInfo.masterName}`);
        console.log(`Document: ${sessionInfo.documentPath}`);
        console.log(`Current blocks: ${client.getBlocks().length}`);
        console.log();
        console.log("Commands:");
        console.log("  add <text>       — add a comment");
        console.log("  blocks           — list current blocks");
        console.log("  peers            — list online peers");
        console.log("  save [file]      — save state locally");
        console.log("  quit             — disconnect");
        console.log();
      } catch (err) {
        console.error(`Failed to connect: ${(err as Error).message}`);
        process.exit(1);
      }

      // Interactive command loop
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${opts.name}> `,
      });

      rl.prompt();

      rl.on("line", async (line: string) => {
        const trimmed = line.trim();
        const [cmd, ...rest] = trimmed.split(" ");

        switch (cmd?.toLowerCase()) {
          case "add": {
            const content = rest.join(" ");
            if (!content) {
              console.log("Usage: add <comment text>");
              break;
            }
            const block: Block = {
              id: randomUUID(),
              type: "comment",
              content,
              author: opts.name,
              timestamp: new Date().toISOString(),
              status: "open",
              spec_version: "0.1",
            };
            client.addBlock(block);
            console.log(`Added comment [${block.id.slice(0, 8)}...]`);
            break;
          }
          case "blocks": {
            const blocks = client.getBlocks();
            if (blocks.length === 0) {
              console.log("No blocks.");
            } else {
              for (const block of blocks) {
                const id = block.id.length > 8 ? block.id.slice(0, 8) + "..." : block.id;
                const status = block.status === "resolved" ? "[resolved]" : "[open]";
                const author = block.author ? ` @${block.author}` : "";
                console.log(`  ${status} ${block.type} ${id}${author} — ${block.content.slice(0, 80)}`);
              }
            }
            break;
          }
          case "peers": {
            const peers = client.presence.getPeers();
            if (peers.length === 0) {
              console.log("No other peers visible.");
            } else {
              for (const peer of peers) {
                console.log(`  ${peer.state.name} (client ${peer.clientId})`);
              }
            }
            break;
          }
          case "save": {
            const outputPath = rest[0] || opts.output || "session.chatter";
            const content = client.materialize();
            await writeFile(resolve(outputPath), content, "utf-8");
            console.log(`State saved to ${outputPath}`);
            break;
          }
          case "quit":
          case "exit":
          case "q": {
            if (opts.output) {
              const content = client.materialize();
              await writeFile(resolve(opts.output), content, "utf-8");
              console.log(`State saved to ${opts.output}`);
            }
            client.disconnect();
            console.log("Disconnected.");
            rl.close();
            process.exit(0);
            break;
          }
          case "":
            break;
          default:
            console.log(`Unknown command: ${cmd}`);
            break;
        }

        rl.prompt();
      });

      rl.on("close", () => {
        client.disconnect();
        process.exit(0);
      });

      process.on("SIGINT", async () => {
        console.log("\nDisconnecting...");
        if (opts.output) {
          const content = client.materialize();
          await writeFile(resolve(opts.output), content, "utf-8");
          console.log(`State saved to ${opts.output}`);
        }
        client.disconnect();
        process.exit(0);
      });
    });

  // -------------------------------------------------------------------------
  // chattermatter session list
  // -------------------------------------------------------------------------
  session
    .command("list")
    .description("List saved sessions")
    .argument("[path]", "Path to document or directory", ".")
    .action(async (pathArg: string) => {
      const docPath = resolve(pathArg);
      const storage = new SessionStorage(docPath);

      const sessions = storage.listSessions();

      if (sessions.length === 0) {
        console.log("No saved sessions found.");
        console.log(`Storage directory: ${storage.getBaseDir()}`);
        return;
      }

      console.log(`Found ${sessions.length} saved session(s):\n`);

      for (const meta of sessions) {
        console.log(`Session: ${meta.sessionId}`);
        console.log(`  Document: ${meta.documentPath}`);
        console.log(`  Master: ${meta.masterName}`);
        console.log(`  Port: ${meta.port}`);
        console.log(`  Created: ${meta.createdAt}`);
        console.log(`  Updated: ${meta.updatedAt}`);
        console.log();
      }

      console.log("Resume a session with:");
      console.log("  chattermatter session resume <session-id>");
    });

  // -------------------------------------------------------------------------
  // chattermatter session resume
  // -------------------------------------------------------------------------
  session
    .command("resume")
    .description("Resume a saved session")
    .argument("<session-id>", "Session ID to resume")
    .option("-p, --port <port>", "Override WebSocket server port")
    .action(async (sessionId: string, opts) => {
      // Try to find the session in the current directory
      const storage = new SessionStorage(resolve("."));
      const stored = storage.loadSession(sessionId);

      if (!stored) {
        console.error(`Session not found: ${sessionId}`);
        console.log("Use 'chattermatter session list' to see available sessions.");
        process.exit(1);
      }

      const port = opts.port ? parseInt(opts.port, 10) : stored.meta.port;

      console.log(`Resuming session: ${sessionId}`);
      console.log(`Document: ${stored.meta.documentPath}`);
      console.log(`Master: ${stored.meta.masterName}`);

      const master = new MasterSession({
        sessionId: stored.meta.sessionId,
        masterName: stored.meta.masterName,
        documentPath: stored.meta.documentPath,
        port,
        sidecar: stored.meta.sidecar,
        initialState: stored.state,
      });

      master.onEvent((event) => {
        switch (event.type) {
          case "peer_joined":
            console.log(`[+] ${event.peer.name} joined as ${event.peer.role} (${event.peer.peerId.slice(0, 8)}...)`);
            break;
          case "peer_left":
            console.log(`[-] Peer ${event.peerId.slice(0, 8)}... left`);
            break;
          case "block_added":
            console.log(`[block] Added ${event.blockId.slice(0, 8)}... by ${event.peerId.slice(0, 8)}...`);
            break;
          case "block_rejected":
            console.log(`[reject] Block ${event.blockId.slice(0, 8)}... from ${event.peerId.slice(0, 8)}...: ${event.reason}`);
            break;
          case "role_changed":
            console.log(`[role] ${event.peerId.slice(0, 8)}... changed from ${event.oldRole} to ${event.newRole}`);
            break;
          case "error":
            console.error(`[error] ${event.message}`);
            break;
        }
      });

      try {
        await master.start();
      } catch (err) {
        const error = err as Error;
        if (error.message.includes("EADDRINUSE")) {
          console.error(`Port ${port} is already in use. Use --port to specify a different port.`);
          process.exit(1);
        }
        throw err;
      }

      console.log(`Listening on ws://localhost:${port}`);
      console.log(`Blocks restored: ${master.getBlocks().length}`);
      console.log();
      console.log("Peers can join with:");
      console.log(`  chattermatter session join ws://localhost:${port} -n <name>`);
      console.log();
      console.log("Commands: (type and press Enter)");
      console.log("  peers          — list connected peers");
      console.log("  blocks         — list current blocks");
      console.log("  save           — save current state to disk");
      console.log("  promote <name> — promote peer to reviewer");
      console.log("  demote <name>  — demote peer to viewer");
      console.log("  quit           — end session and save");
      console.log();

      // Interactive command loop (same as host)
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "session> ",
      });

      rl.prompt();

      rl.on("line", async (line: string) => {
        const trimmed = line.trim();
        const [cmd, ...args] = trimmed.split(/\s+/);
        const cmdLower = cmd?.toLowerCase() ?? "";

        switch (cmdLower) {
          case "peers": {
            const peers = master.getPeers();
            if (peers.length === 0) {
              console.log("No peers connected.");
            } else {
              for (const peer of peers) {
                console.log(`  ${peer.name} (${peer.peerId.slice(0, 8)}...) — ${peer.role} — since ${peer.connectedAt}`);
              }
            }
            break;
          }
          case "blocks": {
            const blocks = master.getBlocks();
            if (blocks.length === 0) {
              console.log("No blocks.");
            } else {
              for (const block of blocks) {
                const id = block.id.length > 8 ? block.id.slice(0, 8) + "..." : block.id;
                const status = block.status === "resolved" ? "[resolved]" : "[open]";
                console.log(`  ${status} ${block.type} ${id} — ${block.content.slice(0, 80)}`);
              }
            }
            break;
          }
          case "save":
            master.save();
            master.saveSession();
            console.log("State saved to disk.");
            break;
          case "promote": {
            const name = args.join(" ");
            if (!name) {
              console.log("Usage: promote <name>");
              break;
            }
            const peer = master.findPeerByName(name);
            if (!peer) {
              console.log(`Peer not found: ${name}`);
              break;
            }
            if (peer.role === "reviewer") {
              console.log(`${name} is already a reviewer.`);
              break;
            }
            master.changePeerRole(peer.peerId, "reviewer");
            console.log(`Promoted ${name} to reviewer.`);
            break;
          }
          case "demote": {
            const name = args.join(" ");
            if (!name) {
              console.log("Usage: demote <name>");
              break;
            }
            const peer = master.findPeerByName(name);
            if (!peer) {
              console.log(`Peer not found: ${name}`);
              break;
            }
            if (peer.role === "viewer") {
              console.log(`${name} is already a viewer.`);
              break;
            }
            master.changePeerRole(peer.peerId, "viewer");
            console.log(`Demoted ${name} to viewer.`);
            break;
          }
          case "quit":
          case "exit":
          case "q":
            console.log("Ending session...");
            await master.stop();
            console.log("Session ended. State saved.");
            rl.close();
            process.exit(0);
            break;
          case "":
            break;
          default:
            console.log(`Unknown command: ${cmdLower}`);
            break;
        }

        rl.prompt();
      });

      rl.on("close", async () => {
        await master.stop();
        process.exit(0);
      });

      process.on("SIGINT", async () => {
        console.log("\nEnding session...");
        await master.stop();
        console.log("Session ended. State saved.");
        process.exit(0);
      });
    });
}
