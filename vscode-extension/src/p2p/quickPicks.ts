/**
 * QuickPicks — dialogs for P2P session operations.
 */

import * as vscode from "vscode";
import * as os from "node:os";
import type { SessionManager } from "./sessionManager.js";
import type { PeerInfo, PeerRole, InviteToken, SessionMeta } from "chattermatter";

/**
 * Get the default display name (OS username or override from config).
 */
function getDefaultDisplayName(): string {
  const config = vscode.workspace.getConfiguration("chattermatter");
  const override = config.get<string>("p2p.displayName", "");
  if (override) return override;

  // Use OS username
  try {
    return os.userInfo().username;
  } catch {
    return "";
  }
}

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
 * Get host session config, using defaults where possible.
 * Returns port and name without prompting unless needed.
 */
export function getHostDefaults(): HostDialogResult {
  const config = vscode.workspace.getConfiguration("chattermatter");
  const defaultPort = config.get<number>("p2p.defaultPort", 4117);
  const defaultName = getDefaultDisplayName();

  return {
    port: defaultPort,
    name: defaultName || "anonymous",
  };
}

/**
 * Show dialog to get an alternative port (when default is in use).
 */
export async function showPortDialog(failedPort: number): Promise<number | undefined> {
  const portStr = await vscode.window.showInputBox({
    prompt: `Port ${failedPort} is in use. Enter an alternative port:`,
    placeHolder: "4118",
    value: String(failedPort + 1),
    validateInput: (value) => {
      const port = parseInt(value, 10);
      if (isNaN(port) || port < 1024 || port > 65535) {
        return "Port must be a number between 1024 and 65535";
      }
      return undefined;
    },
  });

  if (!portStr) return undefined;
  return parseInt(portStr, 10);
}

/**
 * Show dialog to join an existing session.
 */
export async function showJoinDialog(): Promise<JoinDialogResult | undefined> {
  const defaultName = getDefaultDisplayName();

  // Get WebSocket URL
  const config = vscode.workspace.getConfiguration("chattermatter");
  const defaultPort = config.get<number>("p2p.defaultPort", 4117);
  const defaultUrl = `ws://localhost:${defaultPort}`;

  const url = await vscode.window.showInputBox({
    prompt: `Join session as "${defaultName}"`,
    placeHolder: defaultUrl,
    value: defaultUrl,
    validateInput: (value) => {
      if (!value || !value.startsWith("ws://") && !value.startsWith("wss://")) {
        return "URL must start with ws:// or wss://";
      }
      return undefined;
    },
  });

  if (!url) return undefined;

  return {
    url: url.trim(),
    name: defaultName || "anonymous",
    role: "reviewer",
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

  // Owners can manage peers
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
      label: "Moderator",
      description: "Can add, resolve, and delete comments",
      picked: peer.role === "moderator",
      role: "moderator",
    },
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

export type SessionMenuAction = "host" | "join" | "leave" | "peers" | "invite" | "manage-invites" | "resume";

/**
 * Show session menu (clicked from status bar).
 */
export async function showSessionMenu(
  sessionManager: SessionManager,
): Promise<SessionMenuAction | undefined> {
  const isConnected = sessionManager.isConnected();
  const isHosting = sessionManager.isHosting();

  const items: (vscode.QuickPickItem & { action: SessionMenuAction })[] = [];

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
      {
        label: "$(history) Resume Session",
        description: "Resume a previous session",
        action: "resume",
      },
    );
  } else {
    if (isHosting) {
      items.push(
        {
          label: "$(link) Copy Invite Link",
          description: "Generate and copy invite URL",
          action: "invite",
        },
        {
          label: "$(list-flat) Manage Invites",
          description: "View and manage invite links",
          action: "manage-invites",
        },
      );
    }
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

  return selected?.action;
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

// ---------------------------------------------------------------------------
// Invite Token Dialogs
// ---------------------------------------------------------------------------

/**
 * Show dialog to generate a new invite token.
 */
export async function showGenerateInviteDialog(
  sessionManager: SessionManager,
): Promise<string | undefined> {
  if (!sessionManager.isHosting()) {
    vscode.window.showWarningMessage("Only the session host can generate invite links.");
    return undefined;
  }

  // Get available host addresses
  const hosts = sessionManager.getAvailableHosts();

  if (hosts.length === 0) {
    vscode.window.showErrorMessage("No network interfaces available.");
    return undefined;
  }

  // If multiple hosts, let user pick which address to use
  let selectedHost = hosts[0];
  if (hosts.length > 1) {
    const hostItems: (vscode.QuickPickItem & { host: string })[] = hosts.map((host, i) => ({
      label: host,
      description: i === 0 ? "(default)" : undefined,
      host,
    }));

    const picked = await vscode.window.showQuickPick(hostItems, {
      placeHolder: "Which address can your peers reach?",
      title: "Select Network Address",
    });

    if (!picked) return undefined;
    selectedHost = picked.host;
  }

  // Create token and build URL
  const token = sessionManager.createInviteToken();

  if (!token) {
    vscode.window.showErrorMessage("Failed to generate invite link.");
    return undefined;
  }

  const inviteUrl = sessionManager.getInviteUrl(token.token, selectedHost);
  if (!inviteUrl) {
    vscode.window.showErrorMessage("Failed to generate invite URL.");
    return undefined;
  }

  // Copy to clipboard
  await vscode.env.clipboard.writeText(inviteUrl);

  return inviteUrl;
}

/**
 * Show dialog to manage existing invite tokens.
 */
export async function showManageInvitesDialog(
  sessionManager: SessionManager,
): Promise<void> {
  if (!sessionManager.isHosting()) {
    vscode.window.showWarningMessage("Only the session host can manage invite links.");
    return;
  }

  const tokens = sessionManager.getTokens();

  if (tokens.length === 0) {
    const create = await vscode.window.showInformationMessage(
      "No invite links exist. Create one?",
      "Create Invite",
    );
    if (create === "Create Invite") {
      await showGenerateInviteDialog(sessionManager);
    }
    return;
  }

  const items: (vscode.QuickPickItem & { token?: InviteToken })[] = tokens.map((token) => {
    const status = getTokenStatus(token);
    const uses = token.maxUses ? `${token.useCount}/${token.maxUses} uses` : `${token.useCount} uses`;
    return {
      label: `$(link) ${token.token.slice(0, 8)}...`,
      description: `${status} • ${uses}`,
      detail: token.label || `Created ${formatRelativeTime(token.createdAt)}`,
      token,
    };
  });

  items.push({
    label: "$(add) Generate New Invite",
    description: "Create a new invite link",
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select an invite to manage",
    title: "Invite Links",
  });

  if (!selected) return;

  if (!selected.token) {
    // Generate new invite
    await showGenerateInviteDialog(sessionManager);
    return;
  }

  // Show actions for selected token
  const actions: vscode.QuickPickItem[] = [
    { label: "$(clippy) Copy Link", description: "Copy invite URL to clipboard" },
  ];

  if (!selected.token.revokedAt) {
    actions.push({ label: "$(x) Revoke", description: "Invalidate this invite" });
  }
  actions.push({ label: "$(trash) Delete", description: "Remove this invite" });

  const action = await vscode.window.showQuickPick(actions, {
    placeHolder: `Actions for invite ${selected.token.token.slice(0, 8)}...`,
  });

  if (!action) return;

  if (action.label.includes("Copy")) {
    const url = sessionManager.getInviteUrl(selected.token.token);
    if (url) {
      await vscode.env.clipboard.writeText(url);
      vscode.window.showInformationMessage("Invite link copied to clipboard.");
    }
  } else if (action.label.includes("Revoke")) {
    sessionManager.revokeToken(selected.token.token);
    vscode.window.showInformationMessage("Invite link revoked.");
  } else if (action.label.includes("Delete")) {
    sessionManager.deleteToken(selected.token.token);
    vscode.window.showInformationMessage("Invite link deleted.");
  }
}

function getTokenStatus(token: InviteToken): string {
  if (token.revokedAt) return "Revoked";
  if (token.expiresAt && new Date(token.expiresAt) < new Date()) return "Expired";
  if (token.maxUses !== null && token.useCount >= token.maxUses) return "Limit reached";
  return "Active";
}

// ---------------------------------------------------------------------------
// Session Persistence Dialogs
// ---------------------------------------------------------------------------

/**
 * Show dialog to pick a saved session to resume.
 */
export async function showResumeSessionDialog(
  sessionManager: SessionManager,
  docPath: string,
): Promise<SessionMeta | undefined> {
  const sessions = sessionManager.listSessions(docPath);

  if (sessions.length === 0) {
    vscode.window.showInformationMessage("No saved sessions found for this document.");
    return undefined;
  }

  const items: (vscode.QuickPickItem & { session: SessionMeta })[] = sessions.map((session) => ({
    label: `$(history) ${session.masterName}'s session`,
    description: `Port ${session.port} • ${formatRelativeTime(session.updatedAt)}`,
    detail: `Created ${formatRelativeTime(session.createdAt)} • ID: ${session.sessionId.slice(0, 8)}...`,
    session,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a session to resume",
    title: "Resume Session",
  });

  return selected?.session;
}
