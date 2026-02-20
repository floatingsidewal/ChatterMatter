import * as vscode from "vscode";
import { ChatterMatterDecorationProvider } from "./decorations.js";
import { ChatterMatterCommentController } from "./comments.js";

let decorationProvider: ChatterMatterDecorationProvider;
let commentController: ChatterMatterCommentController;

export function activate(context: vscode.ExtensionContext) {
  decorationProvider = new ChatterMatterDecorationProvider();
  commentController = new ChatterMatterCommentController(context);

  // Register commands
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
}

export function deactivate() {
  decorationProvider?.dispose();
  commentController?.dispose();
}
