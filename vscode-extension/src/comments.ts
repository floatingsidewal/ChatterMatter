import * as vscode from "vscode";
import { parse, addComment, resolveBlock, getCleanContent, listBlocks } from "chattermatter";
import { appendBlock, serializeBlock } from "chattermatter";
import type { Block } from "chattermatter";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Integrates with VS Code's native Comment API to provide
 * add, reply, and resolve functionality for ChatterMatter blocks.
 */
export class ChatterMatterCommentController {
  private controller: vscode.CommentController;
  private threads: Map<string, vscode.CommentThread> = new Map();

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
    const author = config.get<string>("author", "");
    const mode = config.get<string>("mode", "inline");

    const markdown = editor.document.getText();

    const { markdown: updated, block } = addComment(markdown, {
      content,
      author: author || undefined,
      anchor: { type: "text", exact: selectedText },
    });

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

    if (thread) {
      // Find the block ID from the thread's comments
      const firstComment = thread.comments[0];
      const blockId = (firstComment as any)?.blockId;
      if (blockId) {
        const markdown = editor.document.getText();
        const updated = resolveBlock(markdown, blockId);
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
      }
    }
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

    const blocks = listBlocks(editor.document.getText());
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
    const blocks = listBlocks(text);

    const config = vscode.workspace.getConfiguration("chattermatter");
    const showResolved = config.get<boolean>("showResolved", false);

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
      if (!showResolved && root.status === "resolved") continue;

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
      thread.label = `${root.type} — ${root.status ?? "open"}`;
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
  return {
    blockId: block.id,
    body: new vscode.MarkdownString(block.content),
    mode: vscode.CommentMode.Preview,
    author: {
      name: block.author ?? "anonymous",
    },
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
