import * as vscode from "vscode";
import { ChatterMatterDecorationProvider } from "./decorations.js";
import { ChatterMatterCommentController } from "./comments.js";
import { SessionManager } from "./p2p/sessionManager.js";
import { P2PStatusBar } from "./p2p/statusBar.js";
import { ReviewPanel } from "./p2p/reviewPanel.js";
import {
  getHostDefaults,
  showPortDialog,
  showJoinDialog,
  showPeersDialog,
  showSessionMenu,
  showGenerateInviteDialog,
  showManageInvitesDialog,
  showResumeSessionDialog,
} from "./p2p/quickPicks.js";

let decorationProvider: ChatterMatterDecorationProvider;
let commentController: ChatterMatterCommentController;
let sessionManager: SessionManager;
let statusBar: P2PStatusBar;
let reviewPanel: ReviewPanel | undefined;

// Debounce utility for throttling frequent updates
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

// Debounced document broadcast (150ms delay for responsive but not excessive updates)
const broadcastDocumentUpdate = debounce((text: string) => {
  sessionManager.updateDocument(text);
}, 150);

export function activate(context: vscode.ExtensionContext) {
  decorationProvider = new ChatterMatterDecorationProvider();
  commentController = new ChatterMatterCommentController(context);
  sessionManager = new SessionManager();
  statusBar = new P2PStatusBar();

  // Set initial context for button visibility
  vscode.commands.executeCommand("setContext", "chattermatter.isConnected", false);

  // Connect comment controller to session manager for P2P operations
  commentController.setSessionManager(sessionManager);

  // Register existing commands
  context.subscriptions.push(
    vscode.commands.registerCommand("chattermatter.addComment", () =>
      commentController.addComment()
    ),
    vscode.commands.registerCommand("chattermatter.submitComment", (reply: vscode.CommentReply) =>
      commentController.submitComment(reply)
    ),
    vscode.commands.registerCommand("chattermatter.replyToThread", (reply: vscode.CommentReply) =>
      commentController.submitComment(reply)
    ),
    vscode.commands.registerCommand("chattermatter.resolveComment", (thread: vscode.CommentThread) =>
      commentController.resolveThread(thread)
    ),
    vscode.commands.registerCommand("chattermatter.deleteComment", (thread: vscode.CommentThread) =>
      commentController.deleteThread(thread)
    ),
    vscode.commands.registerCommand("chattermatter.listComments", () =>
      commentController.listComments()
    ),
    vscode.commands.registerCommand("chattermatter.stripComments", () =>
      commentController.stripComments()
    ),
    vscode.commands.registerCommand("chattermatter.toggleOverlay", () =>
      decorationProvider.toggle()
    ),
  );

  // Register P2P commands
  context.subscriptions.push(
    vscode.commands.registerCommand("chattermatter.hostSession", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "markdown") {
        vscode.window.showWarningMessage("Open a Markdown file to host a review session.");
        return;
      }

      const defaults = getHostDefaults();
      let port = defaults.port;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          statusBar.showConnecting();
          const info = await sessionManager.hostSession(
            editor.document.uri,
            port,
            defaults.name,
          );
          statusBar.update(sessionManager);

          // Auto-generate invite token and copy to clipboard
          const token = sessionManager.createInviteToken();
          if (token) {
            const inviteUrl = sessionManager.getInviteUrl(token.token);
            if (inviteUrl) {
              await vscode.env.clipboard.writeText(inviteUrl);
              vscode.window.showInformationMessage(
                `Hosting on port ${port}. Invite link copied to clipboard!`
              );
              return;
            }
          }

          // Fallback if token generation failed
          vscode.window.showInformationMessage(
            `Hosting review session on port ${port}.`
          );
          return;
        } catch (error) {
          const errorMsg = (error as Error).message;
          // Check if it's a port-in-use error
          if (errorMsg.includes("EADDRINUSE") || errorMsg.includes("address already in use")) {
            const newPort = await showPortDialog(port);
            if (!newPort) {
              statusBar.update(sessionManager);
              return; // User cancelled
            }
            port = newPort;
            attempts++;
          } else {
            statusBar.showError(errorMsg);
            vscode.window.showErrorMessage(`Failed to host session: ${errorMsg}`);
            return;
          }
        }
      }

      vscode.window.showErrorMessage("Failed to find an available port after multiple attempts.");
      statusBar.update(sessionManager);
    }),

    vscode.commands.registerCommand("chattermatter.joinSession", async () => {
      const result = await showJoinDialog();
      if (!result) return;

      try {
        statusBar.showConnecting();
        const info = await sessionManager.joinSession(
          result.url,
          result.name,
          result.role,
        );
        statusBar.update(sessionManager);
        vscode.window.showInformationMessage(
          `Connected to ${info.masterName}'s review session`
        );

        // Open the review panel for peers
        reviewPanel = ReviewPanel.create(context.extensionUri, sessionManager);

        // Set document if we have it
        const doc = sessionManager.getDocument();
        if (doc) {
          reviewPanel.setDocument(doc);
        }

        // Update with current blocks
        reviewPanel.updateComments(sessionManager.getBlocks());
      } catch (error) {
        statusBar.showError((error as Error).message);
        vscode.window.showErrorMessage(`Failed to join session: ${(error as Error).message}`);
      }
    }),

    vscode.commands.registerCommand("chattermatter.leaveSession", async () => {
      if (!sessionManager.isConnected()) {
        vscode.window.showInformationMessage("Not connected to a session.");
        return;
      }

      const isHosting = sessionManager.isHosting();
      const confirmMsg = isHosting
        ? "End the review session? This will disconnect all peers."
        : "Leave the review session?";

      const confirm = await vscode.window.showWarningMessage(
        confirmMsg,
        { modal: true },
        "Yes"
      );

      if (confirm !== "Yes") return;

      await sessionManager.leaveSession();
      statusBar.update(sessionManager);

      // Dispose review panel if it exists
      if (reviewPanel) {
        reviewPanel.dispose();
        reviewPanel = undefined;
      }

      vscode.window.showInformationMessage(
        isHosting ? "Review session ended." : "Left the review session."
      );
    }),

    vscode.commands.registerCommand("chattermatter.showPeers", async () => {
      if (!sessionManager.isConnected()) {
        vscode.window.showInformationMessage("Not connected to a session.");
        return;
      }
      await showPeersDialog(sessionManager);
    }),

    vscode.commands.registerCommand("chattermatter.deleteResolvedComments", async () => {
      if (!sessionManager.isConnected()) {
        vscode.window.showInformationMessage("Not connected to a session.");
        return;
      }

      if (!sessionManager.isHosting()) {
        vscode.window.showWarningMessage("Only the session owner can delete resolved comments.");
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        "Delete all resolved comment threads? This cannot be undone.",
        { modal: true },
        "Delete All Resolved"
      );

      if (confirm !== "Delete All Resolved") return;

      const count = sessionManager.deleteResolvedBlocks();
      if (count > 0) {
        vscode.window.showInformationMessage(`Deleted ${count} resolved comment(s).`);
      } else {
        vscode.window.showInformationMessage("No resolved comments to delete.");
      }
    }),

    vscode.commands.registerCommand("chattermatter.openReviewPanel", async () => {
      if (!sessionManager.isConnected()) {
        vscode.window.showInformationMessage("Not connected to a session.");
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "markdown") {
        vscode.window.showWarningMessage("Open a Markdown file to view the review panel.");
        return;
      }

      // Create or show the review panel
      reviewPanel = ReviewPanel.create(context.extensionUri, sessionManager);

      // Set document content
      if (sessionManager.isHosting()) {
        // For host, use the current editor content
        reviewPanel.setDocument({
          markdown: editor.document.getText(),
          path: editor.document.uri.fsPath,
        });
      } else {
        // For peer, use the received document
        const doc = sessionManager.getDocument();
        if (doc) {
          reviewPanel.setDocument(doc);
        }
      }

      // Update with current blocks
      reviewPanel.updateComments(sessionManager.getBlocks());
    }),

    vscode.commands.registerCommand("chattermatter.showSessionMenu", async () => {
      const action = await showSessionMenu(sessionManager);
      if (!action) return;

      switch (action) {
        case "host":
          vscode.commands.executeCommand("chattermatter.hostSession");
          break;
        case "join":
          vscode.commands.executeCommand("chattermatter.joinSession");
          break;
        case "leave":
          vscode.commands.executeCommand("chattermatter.leaveSession");
          break;
        case "peers":
          vscode.commands.executeCommand("chattermatter.showPeers");
          break;
        case "invite":
          vscode.commands.executeCommand("chattermatter.copyInviteLink");
          break;
        case "manage-invites":
          vscode.commands.executeCommand("chattermatter.manageInvites");
          break;
        case "resume":
          vscode.commands.executeCommand("chattermatter.resumeSession");
          break;
      }
    }),

    vscode.commands.registerCommand("chattermatter.copyInviteLink", async () => {
      if (!sessionManager.isHosting()) {
        vscode.window.showWarningMessage("Only the session host can generate invite links.");
        return;
      }

      const inviteUrl = await showGenerateInviteDialog(sessionManager);
      if (inviteUrl) {
        vscode.window.showInformationMessage("Invite link copied to clipboard!");
      }
    }),

    vscode.commands.registerCommand("chattermatter.manageInvites", async () => {
      await showManageInvitesDialog(sessionManager);
    }),

    vscode.commands.registerCommand("chattermatter.resumeSession", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "markdown") {
        vscode.window.showWarningMessage("Open a Markdown file to resume a session.");
        return;
      }

      const docPath = editor.document.uri.fsPath;
      const session = await showResumeSessionDialog(sessionManager, docPath);
      if (!session) return;

      const defaults = getHostDefaults();
      let port = session.port;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          statusBar.showConnecting();
          const info = await sessionManager.resumeSession(
            session.sessionId,
            docPath,
            port,
            defaults.name,
          );
          statusBar.update(sessionManager);

          // Auto-generate invite token and copy to clipboard
          const token = sessionManager.createInviteToken();
          if (token) {
            const inviteUrl = sessionManager.getInviteUrl(token.token);
            if (inviteUrl) {
              await vscode.env.clipboard.writeText(inviteUrl);
              vscode.window.showInformationMessage(
                `Resumed session on port ${port}. Invite link copied to clipboard!`
              );
              return;
            }
          }

          vscode.window.showInformationMessage(`Resumed session on port ${port}.`);
          return;
        } catch (error) {
          const errorMsg = (error as Error).message;
          if (errorMsg.includes("EADDRINUSE") || errorMsg.includes("address already in use")) {
            const newPort = await showPortDialog(port);
            if (!newPort) {
              statusBar.update(sessionManager);
              return;
            }
            port = newPort;
            attempts++;
          } else {
            statusBar.showError(errorMsg);
            vscode.window.showErrorMessage(`Failed to resume session: ${errorMsg}`);
            return;
          }
        }
      }

      vscode.window.showErrorMessage("Failed to find an available port after multiple attempts.");
      statusBar.update(sessionManager);
    }),
  );

  // Subscribe to session events
  context.subscriptions.push(
    sessionManager.onEvent((event) => {
      // Update status bar and context on any event
      statusBar.update(sessionManager);
      vscode.commands.executeCommand("setContext", "chattermatter.isConnected", sessionManager.isConnected());

      switch (event.type) {
        case "peer_joined":
          vscode.window.showInformationMessage(`${event.peer.name} joined the session`);
          break;

        case "peer_left":
          vscode.window.showInformationMessage(`A peer left the session`);
          break;

        case "block_added":
        case "block_updated":
        case "block_deleted":
          // For master: update decorations and comment threads
          if (sessionManager.isHosting()) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === "markdown") {
              decorationProvider.update(editor);
              commentController.refresh(editor.document);
            }
          }
          // For peer: update WebView
          if (reviewPanel) {
            reviewPanel.updateComments(sessionManager.getBlocks());
          }
          break;

        case "document_received":
          // Peer received document content
          if (reviewPanel && event.document) {
            reviewPanel.setDocument(event.document);
          }
          break;

        case "session_ended":
          vscode.window.showInformationMessage("The review session has ended.");
          if (reviewPanel) {
            reviewPanel.dispose();
            reviewPanel = undefined;
          }
          break;

        case "error":
          vscode.window.showErrorMessage(`P2P Error: ${event.message}`);
          break;

        case "role_changed":
          if (event.peerId === sessionManager.getSessionInfo()?.sessionId) {
            vscode.window.showInformationMessage(`Your role has been changed to ${event.newRole}`);
          }
          break;

        case "document_updated":
          // Peer received updated document from host
          if (reviewPanel) {
            const doc = sessionManager.getDocument();
            if (doc) {
              reviewPanel.setDocument(doc);
            }
          }
          break;
      }
    }),
  );

  // Update decorations on editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) decorationProvider.update(editor);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) {
        decorationProvider.update(editor);
        commentController.refresh(editor.document);

        // If hosting a session, broadcast document updates to peers (debounced)
        if (sessionManager.isHosting() && editor.document.languageId === "markdown") {
          broadcastDocumentUpdate(editor.document.getText());

          // Also update host's ReviewPanel if open
          if (reviewPanel) {
            reviewPanel.setDocument({
              markdown: editor.document.getText(),
              path: editor.document.uri.fsPath,
            });
          }
        }
      }
    }),
  );

  // Watch for sidecar file changes
  const sidecarWatcher = vscode.workspace.createFileSystemWatcher("**/*.chatter");
  context.subscriptions.push(
    sidecarWatcher,
    sidecarWatcher.onDidChange(() => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        decorationProvider.update(editor);
        commentController.refresh(editor.document);
      }
    }),
    sidecarWatcher.onDidCreate(() => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        decorationProvider.update(editor);
        commentController.refresh(editor.document);
      }
    }),
  );

  // Initial update for the active editor
  if (vscode.window.activeTextEditor) {
    decorationProvider.update(vscode.window.activeTextEditor);
    commentController.refresh(vscode.window.activeTextEditor.document);
  }

  // Add disposables
  context.subscriptions.push(
    { dispose: () => sessionManager.dispose() },
    statusBar,
  );
}

export function deactivate() {
  decorationProvider?.dispose();
  commentController?.dispose();
  sessionManager?.dispose();
  statusBar?.dispose();
  reviewPanel?.dispose();
}
