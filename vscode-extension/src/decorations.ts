import * as vscode from "vscode";
import { parse, stripBlocks } from "chattermatter";
import { resolveAnchor } from "chattermatter";
import type { Block, Anchor } from "chattermatter";

/**
 * Provides text decorations for ChatterMatter-anchored regions in Markdown files.
 *
 * Highlights the text that comments are anchored to, and shows gutter icons
 * for commented sections.
 */
export class ChatterMatterDecorationProvider {
  private enabled = true;
  private commentDecorationType: vscode.TextEditorDecorationType;
  private questionDecorationType: vscode.TextEditorDecorationType;
  private suggestionDecorationType: vscode.TextEditorDecorationType;
  private aiDecorationType: vscode.TextEditorDecorationType;

  constructor() {
    const config = vscode.workspace.getConfiguration("chattermatter");
    const highlightColor = config.get<string>("highlightColor", "rgba(255, 212, 0, 0.15)");

    this.commentDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: highlightColor,
      overviewRulerColor: "rgba(255, 212, 0, 0.8)",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.questionDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(0, 150, 255, 0.12)",
      overviewRulerColor: "rgba(0, 150, 255, 0.8)",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.suggestionDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(0, 200, 80, 0.12)",
      overviewRulerColor: "rgba(0, 200, 80, 0.8)",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.aiDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(160, 100, 255, 0.10)",
      overviewRulerColor: "rgba(160, 100, 255, 0.8)",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  }

  toggle(): void {
    this.enabled = !this.enabled;
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      if (this.enabled) {
        this.update(editor);
      } else {
        this.clearAll(editor);
      }
    }
    vscode.window.showInformationMessage(
      `ChatterMatter overlay ${this.enabled ? "enabled" : "disabled"}`
    );
  }

  update(editor: vscode.TextEditor): void {
    if (!this.enabled) return;
    if (editor.document.languageId !== "markdown") return;

    const text = editor.document.getText();
    const { blocks } = parse(text);
    const clean = stripBlocks(text);

    const config = vscode.workspace.getConfiguration("chattermatter");
    const showResolved = config.get<boolean>("showResolved", false);

    const commentRanges: vscode.DecorationOptions[] = [];
    const questionRanges: vscode.DecorationOptions[] = [];
    const suggestionRanges: vscode.DecorationOptions[] = [];
    const aiRanges: vscode.DecorationOptions[] = [];

    for (const pb of blocks) {
      const block = pb.block;

      if (!showResolved && block.status === "resolved") continue;
      if (!block.anchor) continue;

      const resolution = resolveAnchor(block.anchor, clean);
      if (!resolution.resolved) continue;

      // Map clean-text offset back to the original document offset.
      // This is approximate — we find the anchor text in the original document.
      const anchorText = block.anchor.type === "text" ? block.anchor.exact : undefined;
      if (!anchorText) continue;

      const docOffset = text.indexOf(anchorText);
      if (docOffset === -1) continue;

      const startPos = editor.document.positionAt(docOffset);
      const endPos = editor.document.positionAt(docOffset + anchorText.length);
      const range = new vscode.Range(startPos, endPos);

      const hoverContent = formatHoverContent(block);

      const decoration: vscode.DecorationOptions = {
        range,
        hoverMessage: hoverContent,
      };

      switch (block.type) {
        case "question":
          questionRanges.push(decoration);
          break;
        case "suggestion":
          suggestionRanges.push(decoration);
          break;
        case "ai_feedback":
          aiRanges.push(decoration);
          break;
        default:
          commentRanges.push(decoration);
          break;
      }
    }

    editor.setDecorations(this.commentDecorationType, commentRanges);
    editor.setDecorations(this.questionDecorationType, questionRanges);
    editor.setDecorations(this.suggestionDecorationType, suggestionRanges);
    editor.setDecorations(this.aiDecorationType, aiRanges);
  }

  private clearAll(editor: vscode.TextEditor): void {
    editor.setDecorations(this.commentDecorationType, []);
    editor.setDecorations(this.questionDecorationType, []);
    editor.setDecorations(this.suggestionDecorationType, []);
    editor.setDecorations(this.aiDecorationType, []);
  }

  dispose(): void {
    this.commentDecorationType.dispose();
    this.questionDecorationType.dispose();
    this.suggestionDecorationType.dispose();
    this.aiDecorationType.dispose();
  }
}

function formatHoverContent(block: Block): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;

  const typeIcon =
    block.type === "question" ? "❓" :
    block.type === "suggestion" ? "💡" :
    block.type === "ai_feedback" ? "🤖" :
    block.type === "reaction" ? "👍" : "💬";

  const status = block.status === "resolved" ? " _(resolved)_" : "";
  const author = block.author ? ` **@${block.author}**` : "";

  md.appendMarkdown(`${typeIcon}${author}${status}\n\n`);
  md.appendMarkdown(block.content);

  if (block.type === "suggestion" && block.suggestion) {
    md.appendMarkdown(`\n\n---\n`);
    md.appendMarkdown(`\n~~${block.suggestion.original}~~ → ${block.suggestion.replacement}`);
  }

  return md;
}
