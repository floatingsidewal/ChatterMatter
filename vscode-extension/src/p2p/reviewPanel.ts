/**
 * ReviewPanel — WebView panel for peers to view the shared document.
 *
 * Displays the markdown document with comment highlights and allows
 * peers to add new comments by selecting text.
 */

import * as vscode from "vscode";
import type { Block, DocumentContent } from "chattermatter";
import type { SessionManager } from "./sessionManager.js";

export class ReviewPanel {
  public static currentPanel: ReviewPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private sessionManager: SessionManager;
  private documentContent: DocumentContent | null = null;
  private blocks: Block[] = [];
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    sessionManager: SessionManager,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.sessionManager = sessionManager;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables,
    );

    this.updateContent();
  }

  /**
   * Create or show the review panel.
   */
  public static create(
    extensionUri: vscode.Uri,
    sessionManager: SessionManager,
  ): ReviewPanel {
    const column = vscode.ViewColumn.Beside;

    if (ReviewPanel.currentPanel) {
      ReviewPanel.currentPanel.panel.reveal(column);
      ReviewPanel.currentPanel.sessionManager = sessionManager;
      return ReviewPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "chattermatterReview",
      "ChatterMatter Review",
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
        retainContextWhenHidden: true,
      },
    );

    ReviewPanel.currentPanel = new ReviewPanel(panel, extensionUri, sessionManager);
    return ReviewPanel.currentPanel;
  }

  /**
   * Set the document content to display.
   */
  public setDocument(document: DocumentContent): void {
    this.documentContent = document;
    this.updateContent();
  }

  /**
   * Update the comments displayed in the panel.
   */
  public updateComments(blocks: Block[]): void {
    this.blocks = blocks;
    this.panel.webview.postMessage({
      type: "updateComments",
      blocks: blocks.map((b) => ({
        id: b.id,
        type: b.type,
        content: b.content,
        author: b.author,
        timestamp: b.timestamp,
        status: b.status,
        anchor: b.anchor,
      })),
    });
  }

  private handleMessage(message: { type: string; [key: string]: unknown }): void {
    switch (message.type) {
      case "addComment":
        this.handleAddComment(message as { type: string; selectedText: string; content: string });
        break;
      case "ready":
        // WebView is ready, send current state
        if (this.documentContent) {
          this.panel.webview.postMessage({
            type: "setDocument",
            markdown: this.documentContent.markdown,
            path: this.documentContent.path,
          });
        }
        this.updateComments(this.blocks);
        break;
    }
  }

  private async handleAddComment(message: { selectedText: string; content: string }): Promise<void> {
    const { selectedText, content } = message;

    if (!selectedText || !content) return;

    const config = vscode.workspace.getConfiguration("chattermatter");
    const author = config.get<string>("author", "") ||
                   config.get<string>("p2p.displayName", "") ||
                   "anonymous";

    const block: Block = {
      id: generateId(),
      type: "comment",
      content,
      author,
      timestamp: new Date().toISOString(),
      status: "open",
      anchor: { type: "text", exact: selectedText },
    };

    this.sessionManager.addBlock(block);
    vscode.window.showInformationMessage(`Comment added [${block.id.slice(0, 8)}...]`);
  }

  private updateContent(): void {
    this.panel.webview.html = this.getHtmlContent();
  }

  private getHtmlContent(): string {
    const nonce = getNonce();

    // We'll inline the CSS and JS for simplicity
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>ChatterMatter Review</title>
  <style nonce="${nonce}">
    :root {
      --comment-bg: rgba(255, 212, 0, 0.15);
      --question-bg: rgba(0, 150, 255, 0.12);
      --suggestion-bg: rgba(0, 200, 80, 0.12);
      --ai-bg: rgba(160, 100, 255, 0.10);
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 0;
      display: flex;
      height: 100vh;
    }

    .container {
      display: flex;
      width: 100%;
      height: 100%;
    }

    .document-pane {
      flex: 1;
      overflow: auto;
      padding: 20px;
      border-right: 1px solid var(--vscode-panel-border);
    }

    .document-content {
      max-width: 800px;
      margin: 0 auto;
      line-height: 1.6;
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family);
    }

    .document-path {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .sidebar {
      width: 300px;
      overflow: auto;
      padding: 16px;
      background: var(--vscode-sideBar-background);
    }

    .sidebar-header {
      font-weight: bold;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .comment-count {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.85em;
    }

    .comment-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 12px;
    }

    .comment-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-size: 0.85em;
    }

    .comment-author {
      font-weight: bold;
    }

    .comment-type {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.8em;
    }

    .comment-type.comment { background: var(--comment-bg); }
    .comment-type.question { background: var(--question-bg); }
    .comment-type.suggestion { background: var(--suggestion-bg); }
    .comment-type.ai_feedback { background: var(--ai-bg); }

    .comment-content {
      margin-bottom: 8px;
    }

    .comment-anchor {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      border-left: 2px solid var(--vscode-panel-border);
      padding-left: 8px;
    }

    .highlight {
      background: var(--comment-bg);
      cursor: pointer;
    }

    .highlight.question { background: var(--question-bg); }
    .highlight.suggestion { background: var(--suggestion-bg); }
    .highlight.ai_feedback { background: var(--ai-bg); }

    .add-comment-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 300px;
      background: var(--vscode-editor-background);
      border-top: 1px solid var(--vscode-panel-border);
      padding: 12px 20px;
      display: none;
    }

    .add-comment-bar.visible {
      display: block;
    }

    .add-comment-bar input {
      width: calc(100% - 100px);
      padding: 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      margin-right: 8px;
    }

    .add-comment-bar button {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    .add-comment-bar button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .selection-prompt {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin-bottom: 8px;
    }

    .no-comments {
      color: var(--vscode-descriptionForeground);
      text-align: center;
      padding: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="document-pane">
      <div class="document-path" id="documentPath">Loading...</div>
      <div class="document-content" id="documentContent">
        Waiting for document...
      </div>
    </div>
    <div class="sidebar">
      <div class="sidebar-header">
        Comments <span class="comment-count" id="commentCount">0</span>
      </div>
      <div id="commentList">
        <div class="no-comments">No comments yet</div>
      </div>
    </div>
  </div>

  <div class="add-comment-bar" id="addCommentBar">
    <div class="selection-prompt" id="selectionPrompt">Add comment to selected text</div>
    <input type="text" id="commentInput" placeholder="Enter your comment..." />
    <button id="submitComment">Add</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let currentDocument = null;
    let currentBlocks = [];
    let selectedText = '';

    const documentContent = document.getElementById('documentContent');
    const documentPath = document.getElementById('documentPath');
    const commentList = document.getElementById('commentList');
    const commentCount = document.getElementById('commentCount');
    const addCommentBar = document.getElementById('addCommentBar');
    const selectionPrompt = document.getElementById('selectionPrompt');
    const commentInput = document.getElementById('commentInput');
    const submitComment = document.getElementById('submitComment');

    // Handle messages from the extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'setDocument':
          currentDocument = { markdown: message.markdown, path: message.path };
          renderDocument();
          break;
        case 'updateComments':
          currentBlocks = message.blocks;
          renderComments();
          renderDocument(); // Re-render to update highlights
          break;
      }
    });

    // Handle text selection
    documentContent.addEventListener('mouseup', () => {
      const selection = window.getSelection();
      selectedText = selection.toString().trim();

      if (selectedText.length > 0) {
        selectionPrompt.textContent = \`Add comment to: "\${selectedText.slice(0, 50)}\${selectedText.length > 50 ? '...' : ''}"\`;
        addCommentBar.classList.add('visible');
        commentInput.focus();
      } else {
        addCommentBar.classList.remove('visible');
      }
    });

    // Handle comment submission
    submitComment.addEventListener('click', submitNewComment);
    commentInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitNewComment();
    });

    function submitNewComment() {
      const content = commentInput.value.trim();
      if (!content || !selectedText) return;

      vscode.postMessage({
        type: 'addComment',
        selectedText: selectedText,
        content: content
      });

      commentInput.value = '';
      selectedText = '';
      addCommentBar.classList.remove('visible');
      window.getSelection().removeAllRanges();
    }

    function renderDocument() {
      if (!currentDocument) {
        documentContent.textContent = 'Waiting for document...';
        return;
      }

      documentPath.textContent = currentDocument.path;

      // Render markdown with highlights
      let html = escapeHtml(currentDocument.markdown);

      // Apply highlights for each block with an anchor
      for (const block of currentBlocks) {
        if (block.anchor?.type === 'text' && block.anchor.exact) {
          const escapedAnchor = escapeHtml(block.anchor.exact);
          const highlightClass = 'highlight ' + (block.type || 'comment');
          html = html.replace(
            escapedAnchor,
            \`<span class="\${highlightClass}" data-block-id="\${block.id}">\${escapedAnchor}</span>\`
          );
        }
      }

      documentContent.innerHTML = html;
    }

    function renderComments() {
      commentCount.textContent = currentBlocks.length;

      if (currentBlocks.length === 0) {
        commentList.innerHTML = '<div class="no-comments">No comments yet</div>';
        return;
      }

      commentList.innerHTML = currentBlocks.map(block => \`
        <div class="comment-card">
          <div class="comment-header">
            <span class="comment-author">\${escapeHtml(block.author || 'anonymous')}</span>
            <span class="comment-type \${block.type}">\${block.type}</span>
          </div>
          <div class="comment-content">\${escapeHtml(block.content)}</div>
          \${block.anchor?.exact ? \`
            <div class="comment-anchor">"\${escapeHtml(block.anchor.exact.slice(0, 60))}\${block.anchor.exact.length > 60 ? '...' : ''}"</div>
          \` : ''}
        </div>
      \`).join('');
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Signal that we're ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    ReviewPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function generateId(): string {
  // Simple ULID-like ID generation
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return (timestamp + random).toUpperCase();
}
