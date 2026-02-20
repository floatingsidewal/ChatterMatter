/**
 * StatusBar — displays P2P session status in the VS Code status bar.
 */

import * as vscode from "vscode";
import { SessionManager } from "./sessionManager.js";

export class P2PStatusBar {
  private statusItem: vscode.StatusBarItem;

  constructor() {
    this.statusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusItem.command = "chattermatter.showSessionMenu";
    this.updateOffline();
    this.statusItem.show();
  }

  /**
   * Update the status bar based on current session state.
   */
  update(sessionManager: SessionManager): void {
    if (!sessionManager.isConnected()) {
      this.updateOffline();
      return;
    }

    if (sessionManager.isHosting()) {
      const info = sessionManager.getSessionInfo();
      const peers = sessionManager.getPeers();
      const peerCount = peers.length;
      this.statusItem.text = `$(broadcast) ChatterMatter: Hosting (${peerCount} peer${peerCount !== 1 ? "s" : ""})`;
      this.statusItem.tooltip = `Hosting review session on port ${info?.documentPath?.split("/").pop() || "unknown"}\nClick for session options`;
      this.statusItem.backgroundColor = undefined;
    } else {
      const info = sessionManager.getSessionInfo();
      const masterName = info?.masterName || "unknown";
      this.statusItem.text = `$(plug) ChatterMatter: Connected to ${masterName}`;
      this.statusItem.tooltip = `Connected to ${masterName}'s review session\nClick for session options`;
      this.statusItem.backgroundColor = undefined;
    }
  }

  /**
   * Show offline status.
   */
  private updateOffline(): void {
    this.statusItem.text = "$(circle-slash) ChatterMatter: Offline";
    this.statusItem.tooltip = "Not connected to a review session\nClick to host or join";
    this.statusItem.backgroundColor = undefined;
  }

  /**
   * Show connecting status.
   */
  showConnecting(): void {
    this.statusItem.text = "$(sync~spin) ChatterMatter: Connecting...";
    this.statusItem.tooltip = "Connecting to session...";
  }

  /**
   * Show error status briefly.
   */
  showError(message: string): void {
    this.statusItem.text = `$(error) ChatterMatter: Error`;
    this.statusItem.tooltip = message;
    this.statusItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground",
    );

    // Reset after 3 seconds
    setTimeout(() => {
      this.updateOffline();
    }, 3000);
  }

  dispose(): void {
    this.statusItem.dispose();
  }
}
