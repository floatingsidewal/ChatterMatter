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
    const role = this.sessionManager.getRole();
    const canDelete = role === "owner" || role === "moderator";
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
        parent_id: b.parent_id,
      })),
      canDelete,
    });
  }

  private handleMessage(message: { type: string; [key: string]: unknown }): void {
    switch (message.type) {
      case "addComment":
        this.handleAddComment(message as { type: string; selectedText: string; content: string });
        break;
      case "replyToComment":
        this.handleReply(message as { type: string; parentId: string; content: string });
        break;
      case "resolveComment":
        this.handleResolve(message as { type: string; blockId: string });
        break;
      case "deleteComment":
        this.handleDelete(message as { type: string; blockId: string });
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

    // Validate inputs - selectedText must be non-empty for a valid anchor
    if (!selectedText || selectedText.trim().length === 0) {
      vscode.window.showWarningMessage("Please select some text to comment on.");
      return;
    }
    if (!content || content.trim().length === 0) {
      return;
    }

    // Use session username
    const author = this.sessionManager.getUserName() || "anonymous";

    const block: Block = {
      id: generateId(),
      type: "comment",
      content: content.trim(),
      author,
      timestamp: new Date().toISOString(),
      status: "open",
      anchor: { type: "text", exact: selectedText },
    };

    this.sessionManager.addBlock(block);
    vscode.window.showInformationMessage(`Comment added [${block.id.slice(0, 8)}...]`);
  }

  private async handleReply(message: { parentId: string; content: string }): Promise<void> {
    const { parentId, content } = message;

    if (!content || content.trim().length === 0) {
      return;
    }

    // Find the parent block to inherit its anchor
    const parentBlock = this.blocks.find(b => b.id === parentId);
    if (!parentBlock) {
      vscode.window.showErrorMessage("Parent comment not found.");
      return;
    }

    const author = this.sessionManager.getUserName() || "anonymous";

    const block: Block = {
      id: generateId(),
      type: "comment",
      content: content.trim(),
      author,
      timestamp: new Date().toISOString(),
      status: "open",
      parent_id: parentId,
      anchor: parentBlock.anchor, // Inherit parent's anchor
    };

    this.sessionManager.addBlock(block);
    vscode.window.showInformationMessage(`Reply added [${block.id.slice(0, 8)}...]`);
  }

  private async handleResolve(message: { blockId: string }): Promise<void> {
    const { blockId } = message;

    const block = this.blocks.find(b => b.id === blockId);
    if (!block) {
      vscode.window.showErrorMessage("Comment not found.");
      return;
    }

    const resolvedBlock: Block = {
      ...block,
      status: "resolved",
    };

    this.sessionManager.updateBlock(resolvedBlock);
    vscode.window.showInformationMessage(`Comment resolved [${blockId.slice(0, 8)}...]`);
  }

  private async handleDelete(message: { blockId: string }): Promise<void> {
    const { blockId } = message;

    const success = this.sessionManager.deleteBlock(blockId);
    if (success) {
      vscode.window.showInformationMessage(`Comment deleted [${blockId.slice(0, 8)}...]`);
    } else {
      vscode.window.showErrorMessage("Failed to delete comment.");
    }
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

    .document-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .document-path {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }

    .view-toggle {
      display: flex;
      gap: 4px;
    }

    .view-toggle button {
      padding: 4px 8px;
      font-size: 0.8em;
      background: transparent;
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      color: var(--vscode-foreground);
      border-radius: 3px;
      cursor: pointer;
    }

    .view-toggle button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .view-toggle button.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }

    .document-content.raw {
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family);
    }

    .document-content.rendered {
      white-space: normal;
      font-family: var(--vscode-font-family);
    }

    /* Rendered markdown styles */
    .document-content.rendered h1 {
      font-size: 2em;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 0.3em;
      margin: 1em 0 0.5em 0;
    }

    .document-content.rendered h2 {
      font-size: 1.5em;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 0.3em;
      margin: 1em 0 0.5em 0;
    }

    .document-content.rendered h3 {
      font-size: 1.25em;
      margin: 1em 0 0.5em 0;
    }

    .document-content.rendered h4,
    .document-content.rendered h5,
    .document-content.rendered h6 {
      font-size: 1em;
      margin: 1em 0 0.5em 0;
    }

    .document-content.rendered p {
      margin: 0.5em 0;
    }

    .document-content.rendered code {
      background: var(--vscode-textCodeBlock-background);
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
    }

    .document-content.rendered pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 0.5em 0;
    }

    .document-content.rendered pre code {
      background: none;
      padding: 0;
    }

    .document-content.rendered blockquote {
      border-left: 4px solid var(--vscode-textBlockQuote-border);
      margin: 0.5em 0;
      padding-left: 16px;
      color: var(--vscode-textBlockQuote-foreground);
    }

    .document-content.rendered ul,
    .document-content.rendered ol {
      margin: 0.5em 0;
      padding-left: 2em;
    }

    .document-content.rendered li {
      margin: 0.25em 0;
    }

    .document-content.rendered hr {
      border: none;
      border-top: 1px solid var(--vscode-panel-border);
      margin: 1em 0;
    }

    .document-content.rendered a {
      color: var(--vscode-textLink-foreground);
    }

    .document-content.rendered strong {
      font-weight: bold;
    }

    .document-content.rendered em {
      font-style: italic;
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

    .instructions-banner {
      background: var(--vscode-editorInfo-background, rgba(0, 120, 215, 0.1));
      border: 1px solid var(--vscode-editorInfo-foreground, #3794ff);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 16px;
      font-size: 0.9em;
    }

    .instructions-banner strong {
      display: block;
      margin-bottom: 4px;
    }

    .comment-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .comment-actions button {
      padding: 4px 8px;
      font-size: 0.85em;
      background: transparent;
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      color: var(--vscode-foreground);
      border-radius: 3px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .comment-actions button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .reply-form {
      margin-top: 8px;
      display: none;
    }

    .reply-form.visible {
      display: block;
    }

    .reply-form input {
      width: calc(100% - 70px);
      padding: 6px 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 3px;
      font-size: 0.9em;
    }

    .reply-form button {
      padding: 6px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.9em;
      margin-left: 4px;
    }

    .reply-form button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .comment-card.reply {
      margin-left: 16px;
      border-left: 2px solid var(--vscode-panel-border);
    }

    .thread-indicator {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }

    .comment-status {
      margin-left: auto;
      margin-right: 8px;
    }

    .comment-card.resolved {
      opacity: 0.7;
      border-left: 3px solid var(--vscode-testing-iconPassed, #4caf50);
    }

    .comment-card.resolved .comment-content {
      text-decoration: line-through;
      color: var(--vscode-descriptionForeground);
    }

    .resolve-btn, .delete-btn {
      color: var(--vscode-foreground);
    }

    .delete-btn:hover {
      background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1));
      border-color: var(--vscode-inputValidation-errorBorder, #f44336);
    }

    .comment-card.active {
      border-color: var(--vscode-focusBorder, #007acc);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
      background: var(--vscode-editor-selectionBackground, rgba(0, 120, 215, 0.1));
    }

    .highlight {
      background: var(--comment-bg);
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .highlight:hover {
      background: rgba(255, 212, 0, 0.35);
    }

    .highlight.active {
      background: rgba(255, 212, 0, 0.5);
      outline: 2px solid var(--vscode-focusBorder, #007acc);
    }

    .highlight.question { background: var(--question-bg); }
    .highlight.question:hover { background: rgba(0, 150, 255, 0.25); }
    .highlight.question.active { background: rgba(0, 150, 255, 0.4); }

    .highlight.suggestion { background: var(--suggestion-bg); }
    .highlight.suggestion:hover { background: rgba(0, 200, 80, 0.25); }
    .highlight.suggestion.active { background: rgba(0, 200, 80, 0.4); }

    .highlight.ai_feedback { background: var(--ai-bg); }
    .highlight.ai_feedback:hover { background: rgba(160, 100, 255, 0.2); }
    .highlight.ai_feedback.active { background: rgba(160, 100, 255, 0.35); }
  </style>
</head>
<body>
  <div class="container">
    <div class="document-pane">
      <div class="document-header">
        <div class="document-path" id="documentPath">Loading...</div>
        <div class="view-toggle">
          <button id="btnRendered" class="active" title="Rendered view">Rendered</button>
          <button id="btnRaw" title="Raw markdown">Raw</button>
        </div>
      </div>
      <div class="document-content rendered" id="documentContent">
        Waiting for document...
      </div>
    </div>
    <div class="sidebar">
      <div class="sidebar-header">
        Comments <span class="comment-count" id="commentCount">0</span>
      </div>
      <div class="instructions-banner">
        <strong>How to add comments:</strong>
        Select text in the document on the left, then type your comment in the bar that appears at the bottom.
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
    let viewMode = 'rendered'; // 'rendered' or 'raw'
    let canDeleteComments = false; // only masters and moderators can delete

    const documentContent = document.getElementById('documentContent');
    const documentPath = document.getElementById('documentPath');
    const commentList = document.getElementById('commentList');
    const commentCount = document.getElementById('commentCount');
    const addCommentBar = document.getElementById('addCommentBar');
    const selectionPrompt = document.getElementById('selectionPrompt');
    const commentInput = document.getElementById('commentInput');
    const submitComment = document.getElementById('submitComment');
    const btnRendered = document.getElementById('btnRendered');
    const btnRaw = document.getElementById('btnRaw');

    // View mode toggle handlers
    btnRendered.addEventListener('click', () => {
      viewMode = 'rendered';
      btnRendered.classList.add('active');
      btnRaw.classList.remove('active');
      documentContent.classList.add('rendered');
      documentContent.classList.remove('raw');
      renderDocument();
    });

    btnRaw.addEventListener('click', () => {
      viewMode = 'raw';
      btnRaw.classList.add('active');
      btnRendered.classList.remove('active');
      documentContent.classList.add('raw');
      documentContent.classList.remove('rendered');
      renderDocument();
    });

    // Simple markdown to HTML renderer
    function renderMarkdown(text) {
      let html = escapeHtml(text);

      // Code blocks (fenced)
      html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');

      // Inline code
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

      // Headers
      html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
      html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
      html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

      // Bold and italic
      html = html.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
      html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
      html = html.replace(/_(.+?)_/g, '<em>$1</em>');

      // Blockquotes
      html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

      // Horizontal rules
      html = html.replace(/^---$/gm, '<hr>');
      html = html.replace(/^\\*\\*\\*$/gm, '<hr>');

      // Unordered lists
      html = html.replace(/^[\\*\\-] (.+)$/gm, '<li>$1</li>');
      html = html.replace(/(<li>.*<\\/li>\\n?)+/g, '<ul>$&</ul>');

      // Ordered lists
      html = html.replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>');

      // Links
      html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');

      // Paragraphs (double newlines)
      html = html.replace(/\\n\\n/g, '</p><p>');
      html = '<p>' + html + '</p>';

      // Clean up empty paragraphs
      html = html.replace(/<p><\\/p>/g, '');
      html = html.replace(/<p>(<h[1-6]>)/g, '$1');
      html = html.replace(/(<\\/h[1-6]>)<\\/p>/g, '$1');
      html = html.replace(/<p>(<pre>)/g, '$1');
      html = html.replace(/(<\\/pre>)<\\/p>/g, '$1');
      html = html.replace(/<p>(<ul>)/g, '$1');
      html = html.replace(/(<\\/ul>)<\\/p>/g, '$1');
      html = html.replace(/<p>(<blockquote>)/g, '$1');
      html = html.replace(/(<\\/blockquote>)<\\/p>/g, '$1');
      html = html.replace(/<p>(<hr>)/g, '$1');
      html = html.replace(/(<hr>)<\\/p>/g, '$1');

      return html;
    }

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
          canDeleteComments = message.canDelete || false;
          renderComments();
          renderDocument(); // Re-render to update highlights
          break;
      }
    });

    // Handle text selection
    documentContent.addEventListener('mouseup', (e) => {
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

    // Handle clicking on highlighted text to show related comment
    documentContent.addEventListener('click', (e) => {
      const highlight = e.target.closest('.highlight');
      if (highlight) {
        const blockId = highlight.dataset.blockId;
        if (blockId) {
          highlightComment(blockId);
        }
      }
    });

    // Highlight a comment card and scroll it into view
    function highlightComment(blockId) {
      // Remove previous highlights
      document.querySelectorAll('.comment-card.active').forEach(el => {
        el.classList.remove('active');
      });
      document.querySelectorAll('.highlight.active').forEach(el => {
        el.classList.remove('active');
      });

      // Find and highlight the comment card
      const card = document.querySelector('.comment-card[data-block-id="' + blockId + '"]');
      if (card) {
        card.classList.add('active');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Also highlight all text spans for this block
      document.querySelectorAll('.highlight[data-block-id="' + blockId + '"]').forEach(el => {
        el.classList.add('active');
      });

      // Find replies to this comment and highlight them too
      const block = currentBlocks.find(b => b.id === blockId);
      if (block) {
        // If this is a reply, also highlight the parent
        if (block.parent_id) {
          const parentCard = document.querySelector('.comment-card[data-block-id="' + block.parent_id + '"]');
          if (parentCard) {
            parentCard.classList.add('active');
          }
        }
        // Highlight replies to this comment
        currentBlocks.filter(b => b.parent_id === blockId).forEach(reply => {
          const replyCard = document.querySelector('.comment-card[data-block-id="' + reply.id + '"]');
          if (replyCard) {
            replyCard.classList.add('active');
          }
        });
      }
    }

    // Also allow clicking on comment cards to highlight the corresponding text
    commentList.addEventListener('click', (e) => {
      const card = e.target.closest('.comment-card');
      if (card && !e.target.closest('.reply-btn') && !e.target.closest('.reply-form')) {
        const blockId = card.dataset.blockId;
        if (blockId) {
          highlightComment(blockId);
        }
      }
    });

    // Handle comment submission
    submitComment.addEventListener('click', submitNewComment);
    commentInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitNewComment();
    });

    function submitNewComment() {
      const content = commentInput.value.trim();
      const trimmedSelection = selectedText.trim();
      if (!content || !trimmedSelection) return;

      vscode.postMessage({
        type: 'addComment',
        selectedText: trimmedSelection,
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

      let html;

      if (viewMode === 'rendered') {
        // For rendered mode: render markdown first, then apply highlights
        html = renderMarkdown(currentDocument.markdown);

        // Apply highlights by finding anchor text in the rendered HTML
        // We need to be careful not to match inside HTML tags
        for (const block of currentBlocks) {
          if (block.anchor?.type === 'text' && block.anchor.exact) {
            const escapedAnchor = escapeHtml(block.anchor.exact);
            const highlightClass = 'highlight ' + (block.type || 'comment');
            // Only replace text content, not inside tags
            // Use a simple approach: replace first occurrence
            const spanOpen = \`<span class="\${highlightClass}" data-block-id="\${block.id}">\`;
            const spanClose = '</span>';
            html = html.replace(escapedAnchor, spanOpen + escapedAnchor + spanClose);
          }
        }
      } else {
        // Raw mode: escape and apply highlights directly
        html = escapeHtml(currentDocument.markdown);

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
      }

      documentContent.innerHTML = html;
    }

    function renderComments() {
      commentCount.textContent = currentBlocks.length;

      if (currentBlocks.length === 0) {
        commentList.innerHTML = '<div class="no-comments">No comments yet. Select text in the document to add a comment.</div>';
        return;
      }

      // Organize comments into threads (parent comments first, then replies)
      const parentComments = currentBlocks.filter(b => !b.parent_id);
      const replies = currentBlocks.filter(b => b.parent_id);
      const replyMap = new Map();
      for (const reply of replies) {
        if (!replyMap.has(reply.parent_id)) {
          replyMap.set(reply.parent_id, []);
        }
        replyMap.get(reply.parent_id).push(reply);
      }

      let html = '';
      for (const block of parentComments) {
        html += renderCommentCard(block, false);
        // Render replies to this comment
        const blockReplies = replyMap.get(block.id) || [];
        for (const reply of blockReplies) {
          html += renderCommentCard(reply, true);
        }
      }

      // Render orphaned replies (parent not found)
      for (const reply of replies) {
        if (!parentComments.find(p => p.id === reply.parent_id)) {
          html += renderCommentCard(reply, true);
        }
      }

      commentList.innerHTML = html;

      // Attach event listeners for reply buttons
      document.querySelectorAll('.reply-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const blockId = e.currentTarget.dataset.blockId;
          const form = document.getElementById('reply-form-' + blockId);
          if (form) {
            form.classList.toggle('visible');
            if (form.classList.contains('visible')) {
              form.querySelector('input').focus();
            }
          }
        });
      });

      // Attach event listeners for reply submission
      document.querySelectorAll('.reply-submit').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const blockId = e.currentTarget.dataset.blockId;
          submitReply(blockId);
        });
      });

      document.querySelectorAll('.reply-input').forEach(input => {
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            const blockId = e.currentTarget.dataset.blockId;
            submitReply(blockId);
          }
        });
      });

      // Attach event listeners for resolve buttons
      document.querySelectorAll('.resolve-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const blockId = e.currentTarget.dataset.blockId;
          vscode.postMessage({ type: 'resolveComment', blockId });
        });
      });

      // Attach event listeners for delete buttons
      document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const blockId = e.currentTarget.dataset.blockId;
          // Note: confirm() is blocked in WebView sandbox, so delete directly
          vscode.postMessage({ type: 'deleteComment', blockId });
        });
      });
    }

    function renderCommentCard(block, isReply) {
      const statusEmoji = block.status === 'resolved' ? '✅' : '⚠️';
      const isResolved = block.status === 'resolved';
      return \`
        <div class="comment-card \${isReply ? 'reply' : ''} \${isResolved ? 'resolved' : ''}" data-block-id="\${block.id}">
          \${isReply ? '<div class="thread-indicator">↳ Reply</div>' : ''}
          <div class="comment-header">
            <span class="comment-author">\${escapeHtml(block.author || 'anonymous')}</span>
            <span class="comment-status">\${statusEmoji}</span>
            <span class="comment-type \${block.type}">\${block.type}</span>
          </div>
          <div class="comment-content">\${escapeHtml(block.content)}</div>
          \${block.anchor?.exact && !isReply ? \`
            <div class="comment-anchor">"\${escapeHtml(block.anchor.exact.slice(0, 60))}\${block.anchor.exact.length > 60 ? '...' : ''}"</div>
          \` : ''}
          <div class="comment-actions">
            <button class="reply-btn" data-block-id="\${block.id}">💬 Reply</button>
            \${!isResolved ? \`<button class="resolve-btn" data-block-id="\${block.id}">✅ Resolve</button>\` : ''}
            \${canDeleteComments ? \`<button class="delete-btn" data-block-id="\${block.id}">🗑️ Delete</button>\` : ''}
          </div>
          <div class="reply-form" id="reply-form-\${block.id}">
            <input type="text" class="reply-input" data-block-id="\${block.id}" placeholder="Write a reply..." />
            <button class="reply-submit" data-block-id="\${block.id}">Send</button>
          </div>
        </div>
      \`;
    }

    function submitReply(parentId) {
      const input = document.querySelector('.reply-input[data-block-id="' + parentId + '"]');
      const content = input.value.trim();
      if (!content) return;

      vscode.postMessage({
        type: 'replyToComment',
        parentId: parentId,
        content: content
      });

      input.value = '';
      document.getElementById('reply-form-' + parentId).classList.remove('visible');
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
