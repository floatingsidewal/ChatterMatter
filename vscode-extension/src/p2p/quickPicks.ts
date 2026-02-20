/**
 * QuickPicks — dialogs for P2P session operations.
 */

import * as vscode from "vscode";
import type { SessionManager } from "./sessionManager.js";
import type { PeerInfo, PeerRole } from "chattermatter";

interface HostDialogResult {
  port: number;
  name: string;
}

interface JoinDialogResult {
  url: string;
  name: string;
  role: PeerRole;
}

/**
 * Show dialog to host a new session.
 */
export async function showHostDialog(): Promise<HostDialogResult | undefined> {
  const config = vscode.workspace.getConfiguration("chattermatter");
  const defaultPort = config.get<number>("p2p.defaultPort", 4117);
  const savedName = config.get<string>("p2p.displayName", "");

  // Get display name
  const name = await vscode.window.showInputBox({
    prompt: "Enter your display name",
    placeHolder: "Your name",
    value: savedName,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Display name is required";
      }
      return undefined;
    },
  });

  if (!name) return undefined;

  // Get port
  const portStr = await vscode.window.showInputBox({
    prompt: "Enter the port to host on",
    placeHolder: "4117",
    value: String(defaultPort),
    validateInput: (value) => {
      const port = parseInt(value, 10);
      if (isNaN(port) || port < 1024 || port > 65535) {
        return "Port must be a number between 1024 and 65535";
      }
      return undefined;
    },
  });

  if (!portStr) return undefined;

  return {
    port: parseInt(portStr, 10),
    name: name.trim(),
  };
}

/**
 * Show dialog to join an existing session.
 */
export async function showJoinDialog(): Promise<JoinDialogResult | undefined> {
  const config = vscode.workspace.getConfiguration("chattermatter");
  const savedName = config.get<string>("p2p.displayName", "");

  // Get WebSocket URL
  const url = await vscode.window.showInputBox({
    prompt: "Enter the session URL",
    placeHolder: "ws://localhost:4117",
    validateInput: (value) => {
      if (!value || !value.startsWith("ws://") && !value.startsWith("wss://")) {
        return "URL must start with ws:// or wss://";
      }
      return undefined;
    },
  });

  if (!url) return undefined;

  // Get display name
  const name = await vscode.window.showInputBox({
    prompt: "Enter your display name",
    placeHolder: "Your name",
    value: savedName,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Display name is required";
      }
      return undefined;
    },
  });

  if (!name) return undefined;

  // Select role
  const roleItems: vscode.QuickPickItem[] = [
    {
      label: "Reviewer",
      description: "Can add and resolve comments",
      picked: true,
    },
    {
      label: "Viewer",
      description: "Read-only access to comments",
    },
  ];

  const roleSelection = await vscode.window.showQuickPick(roleItems, {
    placeHolder: "Select your role",
    title: "Join as...",
  });

  if (!roleSelection) return undefined;

  const role: PeerRole = roleSelection.label === "Viewer" ? "viewer" : "reviewer";

  return {
    url: url.trim(),
    name: name.trim(),
    role,
  };
}

/**
 * Show list of connected peers.
 */
export async function showPeersDialog(
  sessionManager: SessionManager,
): Promise<void> {
  const peers = sessionManager.getPeers();
  const isHosting = sessionManager.isHosting();

  if (peers.length === 0) {
    vscode.window.showInformationMessage("No peers connected.");
    return;
  }

  const items: (vscode.QuickPickItem & { peer?: PeerInfo })[] = peers.map(
    (peer) => ({
      label: `$(person) ${peer.name}`,
      description: `${peer.role} • Connected ${formatRelativeTime(peer.connectedAt)}`,
      detail: peer.peerId.slice(0, 8) + "...",
      peer,
    }),
  );

  if (!isHosting) {
    // Clients can only view peers
    await vscode.window.showQuickPick(items, {
      placeHolder: "Connected peers",
      title: "Session Peers",
    });
    return;
  }

  // Masters can manage peers
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a peer to manage",
    title: "Session Peers",
  });

  if (!selected?.peer) return;

  // Show actions for selected peer
  const actions: vscode.QuickPickItem[] = [
    { label: "$(shield) Change Role", description: "Change peer's permissions" },
  ];

  const action = await vscode.window.showQuickPick(actions, {
    placeHolder: `Actions for ${selected.peer.name}`,
  });

  if (action?.label.includes("Change Role")) {
    await showRoleChangeDialog(sessionManager, selected.peer);
  }
}

/**
 * Show dialog to change a peer's role.
 */
async function showRoleChangeDialog(
  sessionManager: SessionManager,
  peer: PeerInfo,
): Promise<void> {
  const roles: (vscode.QuickPickItem & { role: PeerRole })[] = [
    {
      label: "Reviewer",
      description: "Can add and resolve comments",
      picked: peer.role === "reviewer",
      role: "reviewer",
    },
    {
      label: "Viewer",
      description: "Read-only access",
      picked: peer.role === "viewer",
      role: "viewer",
    },
  ];

  const selected = await vscode.window.showQuickPick(roles, {
    placeHolder: `Current role: ${peer.role}`,
    title: `Change role for ${peer.name}`,
  });

  if (selected && selected.role !== peer.role) {
    const success = sessionManager.changePeerRole(peer.peerId, selected.role);
    if (success) {
      vscode.window.showInformationMessage(
        `Changed ${peer.name}'s role to ${selected.role}`,
      );
    } else {
      vscode.window.showErrorMessage(`Failed to change ${peer.name}'s role`);
    }
  }
}

/**
 * Show session menu (clicked from status bar).
 */
export async function showSessionMenu(
  sessionManager: SessionManager,
): Promise<"host" | "join" | "leave" | "peers" | undefined> {
  const isConnected = sessionManager.isConnected();
  const isHosting = sessionManager.isHosting();

  const items: (vscode.QuickPickItem & { action: string })[] = [];

  if (!isConnected) {
    items.push(
      {
        label: "$(broadcast) Host Session",
        description: "Start a new review session",
        action: "host",
      },
      {
        label: "$(plug) Join Session",
        description: "Connect to an existing session",
        action: "join",
      },
    );
  } else {
    items.push(
      {
        label: "$(person) Show Peers",
        description: isHosting
          ? `${sessionManager.getPeers().length} connected`
          : "View session members",
        action: "peers",
      },
      {
        label: "$(sign-out) Leave Session",
        description: isHosting ? "End the session for all peers" : "Disconnect from session",
        action: "leave",
      },
    );
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "ChatterMatter P2P",
  });

  return selected?.action as "host" | "join" | "leave" | "peers" | undefined;
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleDateString();
}
