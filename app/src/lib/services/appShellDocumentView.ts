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
  content: string;
  filePath: string | null;
  html: string;
};

/**
 * Memoizes rendered document markdown by document id. Content-string keys
 * retained every keystroke's full buffer (up to CACHE_MAX copies). One slot
 * per document overwrites in place on edit; {@link retainDocumentMarkdownHtml}
 * drops entries whose documents are no longer open.
 */
const markdownHtmlCache = new Map<string, MarkdownHtmlCacheEntry>();
const MARKDOWN_HTML_CACHE_MAX = 64;

/**
 * Render document markdown through the shared memo.
 *
 * Exported so components that debounce their preview input can render the trailing
 * content directly instead of going through {@link deriveAppShellDocumentView}, which
 * only ever sees the live buffer.
 */
export function renderMemoizedDocumentMarkdown(
  documentId: string,
  content: string,
  filePath: string | null,
): string {
  return getMemoizedMarkdownHtml(documentId, content, filePath);
}

function getMemoizedMarkdownHtml(
  documentId: string,
  content: string,
  filePath: string | null,
): string {
  const cached = markdownHtmlCache.get(documentId);
  if (cached && cached.content === content && cached.filePath === filePath) {
    return cached.html;
  }
  const html = renderDocumentMarkdown(content, filePath);
  if (!markdownHtmlCache.has(documentId) && markdownHtmlCache.size >= MARKDOWN_HTML_CACHE_MAX) {
    const firstKey = markdownHtmlCache.keys().next().value;
    if (firstKey !== undefined) {
      markdownHtmlCache.delete(firstKey);
    }
  }
  markdownHtmlCache.set(documentId, { content, filePath, html });
  return html;
}

/** Drop memoized preview HTML (full clear or one document id). */
export function invalidateDocumentMarkdownHtml(documentId?: string): void {
  if (documentId === undefined) {
    markdownHtmlCache.clear();
    return;
  }
  markdownHtmlCache.delete(documentId);
}

/** Keep only cache entries for documents that are still open. */
export function retainDocumentMarkdownHtml(documentIds: ReadonlySet<string>): void {
  for (const documentId of markdownHtmlCache.keys()) {
    if (!documentIds.has(documentId)) {
      markdownHtmlCache.delete(documentId);
    }
  }
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
      ? getMemoizedMarkdownHtml(
          activeDocument.id,
          activeDocument.content,
          activeDocument.filePath ?? null,
        )
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

/**
 * Memoized {@link deriveAppShellDocumentView} keyed on the document reference
 * (P03-08-24b). The keep-alive editor grid calls this per entry per emit; the
 * per-pane active-document call re-runs on every app-state emit. With the
 * default `renderMarkdownHtml = false`, the view is a pure function of the
 * document's immutable-for-its-lifetime fields (contentKind, language,
 * diskFingerprint, filePath, title), so a document reference that hasn't
 * changed yields an identical view. The WeakMap returns the cached view until
 * the document object is replaced (content edit, reload).
 *
 * `renderMarkdownHtml = true` callers bypass the memo (the HTML depends on the
 * content string, which changes within the same document reference).
 */
const documentViewCache = new WeakMap<DocumentState, AppShellDocumentView>();

export function deriveAppShellDocumentViewMemoized(
  activeDocument: DocumentState | undefined,
  options: DeriveAppShellDocumentViewOptions = {},
): AppShellDocumentView {
  if (
    !activeDocument ||
    (options.renderMarkdownHtml ?? false) ||
    activeDocument.contentKind === "large_pending"
  ) {
    // Large-pending documents transition to text once confirmed, but while
    // pending the same document reference can flip its view as the confirm
    // dialog state changes — bypass the memo for that kind.
    return deriveAppShellDocumentView(activeDocument, options);
  }
  const cached = documentViewCache.get(activeDocument);
  if (cached) {
    return cached;
  }
  const view = deriveAppShellDocumentView(activeDocument, options);
  documentViewCache.set(activeDocument, view);
  return view;
}
