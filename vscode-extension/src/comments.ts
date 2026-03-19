import * as vscode from "vscode";
import { parse, addComment, resolveBlock, getCleanContent, listBlocks } from "chattermatter";
import { appendBlock, serializeBlock } from "chattermatter";
import type { Block } from "chattermatter";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import type { SessionManager } from "./p2p/sessionManager.js";

/**
 * Load blocks from both the markdown file and its sidecar (.chatter) if present.
 */
function loadAllBlocks(documentPath: string, documentText: string): Block[] {
  // Get blocks from the markdown file (inline blocks)
  const inlineBlocks = listBlocks(documentText);

  // Get blocks from the sidecar file if it exists
  const sidecarPath = documentPath + ".chatter";
  let sidecarBlocks: Block[] = [];
  if (existsSync(sidecarPath)) {
    try {
      const sidecarContent = readFileSync(sidecarPath, "utf-8");
      sidecarBlocks = listBlocks(sidecarContent);
    } catch {
      // Ignore read errors
    }
  }

  // Combine blocks, deduplicating by ID (sidecar takes precedence)
  const blockMap = new Map<string, Block>();
  for (const block of inlineBlocks) {
    blockMap.set(block.id, block);
  }
  for (const block of sidecarBlocks) {
    blockMap.set(block.id, block);
  }

  return Array.from(blockMap.values());
}

/**
 * Integrates with VS Code's native Comment API to provide
 * add, reply, and resolve functionality for ChatterMatter blocks.
 */
export class ChatterMatterCommentController {
  private controller: vscode.CommentController;
  private threads: Map<string, vscode.CommentThread> = new Map();
  private sessionManager: SessionManager | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this.controller = vscode.comments.createCommentController(
      "chattermatter",
      "ChatterMatter"
    );
    this.controller.commentingRangeProvider = {
      provideCommentingRanges(document: vscode.TextDocument) {
        if (document.languageId !== "markdown") return [];
        // Allow commenting on any line
        return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
      },
    };

    context.subscriptions.push(this.controller);
  }

  /**
   * Set the session manager for P2P operations.
   */
  setSessionManager(sessionManager: SessionManager): void {
    this.sessionManager = sessionManager;
  }

  /**
   * Handle comment submission from VS Code's native comment UI.
   * Called when user types in the comment box and clicks the save button.
   */
  async submitComment(reply: vscode.CommentReply): Promise<void> {
    const thread = reply.thread;
    const text = reply.text.trim();

    if (!text) return;

    const document = await vscode.workspace.openTextDocument(thread.uri);
    if (document.languageId !== "markdown") return;

    // Get the selected text from the thread's range
    const selectedText = document.getText(thread.range);

    const config = vscode.workspace.getConfiguration("chattermatter");
    // Use session username if in P2P session, otherwise fall back to config
    const author = this.sessionManager?.isConnected()
      ? this.sessionManager.getUserName()
      : (config.get<string>("author", "") || config.get<string>("p2p.displayName", ""));
    const mode = config.get<string>("mode", "sidecar");

    const markdown = document.getText();

    const { markdown: updated, block } = addComment(markdown, {
      content: text,
      author: author || "anonymous",
      anchor: { type: "text", exact: selectedText },
    });

    // If connected to a P2P session, use sessionManager to sync
    if (this.sessionManager?.isConnected()) {
      this.sessionManager.addBlock(block);
      // Add the comment to the thread UI
      thread.comments = [...thread.comments, blockToComment(block)];
      vscode.window.showInformationMessage(`Comment added [${block.id.slice(0, 8)}...]`);
      return;
    }

    // Otherwise (not in P2P session), write to file
    if (mode === "sidecar") {
      const sidecarPath = thread.uri.fsPath + ".chatter";
      let sidecarContent = "";
      try {
        sidecarContent = await readFile(sidecarPath, "utf-8");
      } catch {
        // No existing sidecar
      }
      const newContent = sidecarContent
        ? appendBlock(sidecarContent, block)
        : serializeBlock(block) + "\n";
      await writeFile(sidecarPath, newContent, "utf-8");
    } else {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        thread.uri,
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(markdown.length)
        ),
        updated
      );
      await vscode.workspace.applyEdit(edit);
    }

    // Add the comment to the thread UI
    thread.comments = [...thread.comments, blockToComment(block)];
    vscode.window.showInformationMessage(`Comment added [${block.id.slice(0, 8)}...]`);
  }

  /**
   * Add a comment at the current selection.
   */
  async addComment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      vscode.window.showWarningMessage("Open a Markdown file to add a comment.");
      return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showWarningMessage("Select text to comment on.");
      return;
    }

    const selectedText = editor.document.getText(selection);

    const content = await vscode.window.showInputBox({
      prompt: "Enter your comment",
      placeHolder: "Your feedback...",
    });

    if (!content) return;

    const config = vscode.workspace.getConfiguration("chattermatter");
    // Use session username if in P2P session, otherwise fall back to config
    const author = this.sessionManager?.isConnected()
      ? this.sessionManager.getUserName()
      : config.get<string>("author", "");
    const mode = config.get<string>("mode", "inline");

    const markdown = editor.document.getText();

    const { markdown: updated, block } = addComment(markdown, {
      content,
      author: author || "anonymous",
      anchor: { type: "text", exact: selectedText },
    });

    // If connected to a P2P session, use sessionManager to sync
    if (this.sessionManager?.isConnected()) {
      if (this.sessionManager.isHosting()) {
        // Host: add to CRDT (will sync to peers and save to file)
        this.sessionManager.addBlock(block);
        vscode.window.showInformationMessage(`Comment added [${block.id.slice(0, 8)}...]`);
        return;
      } else {
        // Client: add to CRDT (will sync to master)
        this.sessionManager.addBlock(block);
        vscode.window.showInformationMessage(`Comment added [${block.id.slice(0, 8)}...]`);
        return;
      }
    }

    // Otherwise (not in P2P session), write to file as usual
    if (mode === "sidecar") {
      const sidecarPath = editor.document.uri.fsPath + ".chatter";
      let sidecarContent = "";
      try {
        sidecarContent = await readFile(sidecarPath, "utf-8");
      } catch {
        // No existing sidecar
      }
      const newContent = sidecarContent
        ? appendBlock(sidecarContent, block)
        : serializeBlock(block) + "\n";
      await writeFile(sidecarPath, newContent, "utf-8");
    } else {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        editor.document.uri,
        new vscode.Range(
          editor.document.positionAt(0),
          editor.document.positionAt(markdown.length)
        ),
        updated
      );
      await vscode.workspace.applyEdit(edit);
    }

    vscode.window.showInformationMessage(`Comment added [${block.id.slice(0, 8)}...]`);
  }

  /**
   * Resolve a comment thread.
   */
  async resolveThread(thread?: vscode.CommentThread): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    if (!thread) return;

    // Find the block ID from the thread's comments
    const firstComment = thread.comments[0];
    const blockId = (firstComment as any)?.blockId;
    if (!blockId) return;

    // If connected to a P2P session, use sessionManager to update
    if (this.sessionManager?.isConnected()) {
      const blocks = this.sessionManager.getBlocks();
      const block = blocks.find(b => b.id === blockId);
      if (block) {
        const resolvedBlock: Block = {
          ...block,
          status: "resolved",
        };
        this.sessionManager.updateBlock(resolvedBlock);
        thread.dispose();
        vscode.window.showInformationMessage(`Comment resolved [${blockId.slice(0, 8)}...]`);
      }
      return;
    }

    // Not in P2P session - try sidecar first, then inline
    const sidecarPath = editor.document.uri.fsPath + ".chatter";
    if (existsSync(sidecarPath)) {
      try {
        const sidecarContent = readFileSync(sidecarPath, "utf-8");
        const blocks = listBlocks(sidecarContent);
        const block = blocks.find(b => b.id === blockId);
        if (block) {
          const resolvedBlock: Block = { ...block, status: "resolved" };
          // Rewrite the sidecar file with the updated block
          const updatedBlocks = blocks.map(b => b.id === blockId ? resolvedBlock : b);
          const newContent = updatedBlocks.map(b => serializeBlock(b)).join("\n\n") + "\n";
          await writeFile(sidecarPath, newContent, "utf-8");
          thread.dispose();
          vscode.window.showInformationMessage(`Comment resolved [${blockId.slice(0, 8)}...]`);
          return;
        }
      } catch {
        // Fall through to inline
      }
    }

    // Try inline resolution
    const markdown = editor.document.getText();
    const updated = resolveBlock(markdown, blockId);
    if (updated !== markdown) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        editor.document.uri,
        new vscode.Range(
          editor.document.positionAt(0),
          editor.document.positionAt(markdown.length)
        ),
        updated
      );
      await vscode.workspace.applyEdit(edit);
      thread.dispose();
      vscode.window.showInformationMessage(`Comment resolved [${blockId.slice(0, 8)}...]`);
    }
  }

  /**
   * Delete a comment thread.
   */
  async deleteThread(thread?: vscode.CommentThread): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    if (!thread) return;

    // Find the block ID from the thread's comments
    const firstComment = thread.comments[0];
    const blockId = (firstComment as any)?.blockId;
    if (!blockId) return;

    // If connected to a P2P session, use sessionManager to delete
    if (this.sessionManager?.isConnected()) {
      const success = this.sessionManager.deleteBlock(blockId);
      if (success) {
        thread.dispose();
        vscode.window.showInformationMessage(`Comment deleted [${blockId.slice(0, 8)}...]`);
      } else {
        vscode.window.showErrorMessage("Failed to delete comment.");
      }
      return;
    }

    // Not in P2P session - try sidecar first, then inline
    const sidecarPath = editor.document.uri.fsPath + ".chatter";
    if (existsSync(sidecarPath)) {
      try {
        const sidecarContent = readFileSync(sidecarPath, "utf-8");
        const blocks = listBlocks(sidecarContent);
        const blockIndex = blocks.findIndex(b => b.id === blockId);
        if (blockIndex !== -1) {
          // Remove the block and its children
          const updatedBlocks = blocks.filter(b => b.id !== blockId && b.parent_id !== blockId);
          const newContent = updatedBlocks.length > 0
            ? updatedBlocks.map(b => serializeBlock(b)).join("\n\n") + "\n"
            : "";
          await writeFile(sidecarPath, newContent, "utf-8");
          thread.dispose();
          vscode.window.showInformationMessage(`Comment deleted [${blockId.slice(0, 8)}...]`);
          return;
        }
      } catch {
        // Fall through to inline
      }
    }

    // Try inline deletion (remove the block from the markdown)
    const markdown = editor.document.getText();
    const cleanContent = getCleanContent(markdown);
    // Note: This removes ALL blocks. For selective deletion, we'd need a more targeted approach.
    // For now, just show an error for inline mode.
    vscode.window.showWarningMessage("Delete is not supported for inline comments. Use sidecar mode.");
  }

  /**
   * List all comments in a quick-pick panel.
   */
  async listComments(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      vscode.window.showWarningMessage("Open a Markdown file first.");
      return;
    }

    // Load blocks from both inline and sidecar sources
    const blocks = loadAllBlocks(editor.document.uri.fsPath, editor.document.getText());
    if (blocks.length === 0) {
      vscode.window.showInformationMessage("No ChatterMatter comments found.");
      return;
    }

    const items = blocks.map((block) => ({
      label: `${typeIcon(block.type)} ${block.content.slice(0, 80)}`,
      description: `${block.type} • ${block.status ?? "open"}${block.author ? ` • @${block.author}` : ""}`,
      detail: block.anchor?.type === "text" ? `Anchored to: "${block.anchor.exact.slice(0, 60)}"` : undefined,
      block,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a comment to jump to",
    });

    if (selected && selected.block.anchor?.type === "text") {
      const text = editor.document.getText();
      const offset = text.indexOf(selected.block.anchor.exact);
      if (offset !== -1) {
        const pos = editor.document.positionAt(offset);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    }
  }

  /**
   * Strip all ChatterMatter blocks from the document.
   */
  async stripComments(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") return;

    const confirm = await vscode.window.showWarningMessage(
      "Remove all ChatterMatter blocks from this document?",
      { modal: true },
      "Strip"
    );

    if (confirm !== "Strip") return;

    const markdown = editor.document.getText();
    const clean = getCleanContent(markdown);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      editor.document.uri,
      new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(markdown.length)
      ),
      clean
    );
    await vscode.workspace.applyEdit(edit);
  }

  /**
   * Refresh comment threads from the document content.
   */
  refresh(document: vscode.TextDocument): void {
    if (document.languageId !== "markdown") return;

    // Dispose existing threads
    for (const thread of this.threads.values()) {
      thread.dispose();
    }
    this.threads.clear();

    const text = document.getText();
    // Load blocks from both inline and sidecar sources
    const blocks = loadAllBlocks(document.uri.fsPath, text);

    // Group blocks into threads by root
    const roots = blocks.filter((b) => !b.parent_id);
    const childMap = new Map<string, Block[]>();
    for (const block of blocks) {
      if (block.parent_id) {
        const children = childMap.get(block.parent_id) ?? [];
        children.push(block);
        childMap.set(block.parent_id, children);
      }
    }

    for (const root of roots) {
      // Always show all comments (resolved and open)

      // Find the range in the document
      let range: vscode.Range;
      if (root.anchor?.type === "text") {
        const offset = text.indexOf(root.anchor.exact);
        if (offset !== -1) {
          const start = document.positionAt(offset);
          const end = document.positionAt(offset + root.anchor.exact.length);
          range = new vscode.Range(start, end);
        } else {
          range = new vscode.Range(0, 0, 0, 0);
        }
      } else {
        range = new vscode.Range(0, 0, 0, 0);
      }

      const comments: vscode.Comment[] = [];

      // Root comment
      comments.push(blockToComment(root));

      // Child comments
      const children = childMap.get(root.id) ?? [];
      for (const child of children) {
        comments.push(blockToComment(child));
      }

      const thread = this.controller.createCommentThread(
        document.uri,
        range,
        comments
      );
      thread.canReply = true;
      thread.label = `${typeIcon(root.type)} ${root.type} — ${statusIcon(root.status)} ${root.status ?? "open"}`;
      // Collapse resolved threads to reduce visual clutter
      if (root.status === "resolved") {
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      }
      this.threads.set(root.id, thread);
    }
  }

  dispose(): void {
    for (const thread of this.threads.values()) {
      thread.dispose();
    }
    this.controller.dispose();
  }
}

function blockToComment(block: Block): vscode.Comment & { blockId: string } {
  const status = block.status ?? "open";
  return {
    blockId: block.id,
    body: new vscode.MarkdownString(block.content),
    mode: vscode.CommentMode.Preview,
    author: {
      name: block.author ?? "anonymous",
    },
    label: `${statusIcon(status)} ${status}`,
    timestamp: block.timestamp ? new Date(block.timestamp) : undefined,
  };
}

function typeIcon(type: string): string {
  switch (type) {
    case "question": return "❓";
    case "suggestion": return "💡";
    case "ai_feedback": return "🤖";
    case "reaction": return "👍";
    default: return "💬";
  }
}

function statusIcon(status?: string): string {
  switch (status) {
    case "resolved": return "✅";
    case "open": return "⚠️";
    default: return "⚠️";
  }
}
