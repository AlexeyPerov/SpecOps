import type { DocumentState } from "../domain/contracts";
import { normalizePathSync } from "./diskFingerprint";
import { formatStatusPath } from "./appShellHelpers";
import { DEFAULT_UNTITLED_TITLE } from "./untitledTitle";
import { renderDocumentMarkdown } from "./markdownImageSrc";

export interface AppShellDocumentView {
  isImageDocument: boolean;
  isBinaryDocument: boolean;
  isLargePendingDocument: boolean;
  isTextEditorDocument: boolean;
  previewFileSizeBytes: number;
  isMarkdownDocument: boolean;
  markdownHtml: string;
  statusPath: string;
  activeDocumentPath: string | null;
}

export interface DeriveAppShellDocumentViewOptions {
  renderMarkdownHtml?: boolean;
}

type MarkdownHtmlCacheEntry = {
  filePath: string | null;
  html: string;
};

/**
 * Memoizes rendered document markdown by content string identity (and file
 * path, which affects local image resolution). Scroll/cursor/fingerprint
 * updates replace the DocumentState object but reuse the same content string,
 * so preview panes skip a full marked parse on those ticks. Keep-alive sibling
 * tabs also hit this when the active document is the only one that changed.
 *
 * Bounded like chat markdown: Map insertion order gives approximate LRU
 * eviction (re-hits do not refresh order; that is fine for this hot path).
 */
const markdownHtmlCache = new Map<string, MarkdownHtmlCacheEntry>();
const MARKDOWN_HTML_CACHE_MAX = 64;

function getMemoizedMarkdownHtml(content: string, filePath: string | null): string {
  const cached = markdownHtmlCache.get(content);
  if (cached && cached.filePath === filePath) {
    return cached.html;
  }
  const html = renderDocumentMarkdown(content, filePath);
  if (markdownHtmlCache.size >= MARKDOWN_HTML_CACHE_MAX) {
    const firstKey = markdownHtmlCache.keys().next().value;
    if (firstKey !== undefined) {
      markdownHtmlCache.delete(firstKey);
    }
  }
  markdownHtmlCache.set(content, { filePath, html });
  return html;
}

/** Test helper: drop memoized preview HTML (full clear or one content key). */
export function invalidateDocumentMarkdownHtml(content?: string): void {
  if (content === undefined) {
    markdownHtmlCache.clear();
    return;
  }
  markdownHtmlCache.delete(content);
}

/** True when the document should mount a text editor (not image/binary/large). */
export function isTextEditorDocumentState(
  documentState: DocumentState | undefined,
): documentState is DocumentState {
  if (!documentState) {
    return false;
  }
  return (
    documentState.contentKind !== "image" &&
    documentState.contentKind !== "binary" &&
    documentState.contentKind !== "large_pending"
  );
}

export function deriveAppShellDocumentView(
  activeDocument: DocumentState | undefined,
  options: DeriveAppShellDocumentViewOptions = {},
): AppShellDocumentView {
  const isImageDocument = activeDocument?.contentKind === "image";
  const isBinaryDocument = activeDocument?.contentKind === "binary";
  const isLargePendingDocument = activeDocument?.contentKind === "large_pending";
  const isTextEditorDocument = isTextEditorDocumentState(activeDocument);
  const previewFileSizeBytes = activeDocument?.diskFingerprint?.sizeBytes ?? 0;
  const isMarkdownDocument = isTextEditorDocument && activeDocument?.language === "markdown";
  const renderMarkdownHtml = options.renderMarkdownHtml ?? false;
  const markdownHtml =
    renderMarkdownHtml && isMarkdownDocument && activeDocument
      ? getMemoizedMarkdownHtml(activeDocument.content, activeDocument.filePath ?? null)
      : "";
  const statusPath = formatStatusPath(
    activeDocument?.filePath ?? null,
    activeDocument?.title,
    DEFAULT_UNTITLED_TITLE,
  );
  const activeDocumentPath = activeDocument?.filePath
    ? normalizePathSync(activeDocument.filePath)
    : null;

  return {
    isImageDocument,
    isBinaryDocument,
    isLargePendingDocument,
    isTextEditorDocument,
    previewFileSizeBytes,
    isMarkdownDocument,
    markdownHtml,
    statusPath,
    activeDocumentPath,
  };
}
