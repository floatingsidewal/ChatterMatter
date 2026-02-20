import * as vscode from "vscode";
import { ChatterMatterDecorationProvider } from "./decorations.js";
import { ChatterMatterCommentController } from "./comments.js";
import { SessionManager } from "./p2p/sessionManager.js";
import { P2PStatusBar } from "./p2p/statusBar.js";
import { ReviewPanel } from "./p2p/reviewPanel.js";
import {
  showHostDialog,
  showJoinDialog,
  showPeersDialog,
  showSessionMenu,
} from "./p2p/quickPicks.js";

let decorationProvider: ChatterMatterDecorationProvider;
let commentController: ChatterMatterCommentController;
let sessionManager: SessionManager;
let statusBar: P2PStatusBar;
let reviewPanel: ReviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  decorationProvider = new ChatterMatterDecorationProvider();
  commentController = new ChatterMatterCommentController(context);
  sessionManager = new SessionManager();
  statusBar = new P2PStatusBar();

  // Connect comment controller to session manager for P2P operations
  commentController.setSessionManager(sessionManager);

  // Register existing commands
  context.subscriptions.push(
    vscode.commands.registerCommand("chattermatter.addComment", () =>
      commentController.addComment()
    ),
    vscode.commands.registerCommand("chattermatter.resolveComment", (thread: vscode.CommentThread) =>
      commentController.resolveThread(thread)
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

      const result = await showHostDialog();
      if (!result) return;

      try {
        statusBar.showConnecting();
        const info = await sessionManager.hostSession(
          editor.document.uri,
          result.port,
          result.name,
        );
        statusBar.update(sessionManager);
        vscode.window.showInformationMessage(
          `Hosting review session on port ${result.port}. Share ws://localhost:${result.port} with peers.`
        );
      } catch (error) {
        statusBar.showError((error as Error).message);
        vscode.window.showErrorMessage(`Failed to host session: ${(error as Error).message}`);
      }
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
      }
    }),
  );

  // Subscribe to session events
  context.subscriptions.push(
    sessionManager.onEvent((event) => {
      // Update status bar on any event
      statusBar.update(sessionManager);

      switch (event.type) {
        case "peer_joined":
          vscode.window.showInformationMessage(`${event.peer.name} joined the session`);
          break;

        case "peer_left":
          vscode.window.showInformationMessage(`A peer left the session`);
          break;

        case "block_added":
        case "block_updated":
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
