import type {
  DocumentContentKind,
  DocumentIdentity,
  DocumentState,
  MarkdownViewMode,
} from "../../domain/contracts";
import { inferEditorLanguage } from "../../editor/editorLanguage";
import { emptyUnsavedDocumentTitle } from "../../services/untitledDocument";
import type { DocumentLineEnding } from "../../services/textEncoding";
import { detectLineEnding } from "../../services/textEncoding";

export function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

export function inferLanguage(path: string | null): string {
  return inferEditorLanguage(path);
}

export function buildEmptyUnsavedDocument(documentId: string): DocumentState {
  return buildDocument({ id: documentId, filePath: null }, "", emptyUnsavedDocumentTitle());
}

export function buildDocument(
  identity: DocumentIdentity,
  content: string,
  title: string,
  contentKind: DocumentContentKind = "text",
  defaultMarkdownViewMode: MarkdownViewMode = "edit",
  encoding?: { lineEnding?: DocumentLineEnding; hasBom?: boolean },
): DocumentState {
  const language = inferLanguage(identity.filePath);
  return {
    id: identity.id,
    filePath: identity.filePath,
    title,
    content,
    savedContent: content,
    isDirty: false,
    contentKind,
    language,
    encoding: "utf-8",
    // Callers that opened a file pass the detected line ending. For buffers with no
    // file behind them (new drafts, transferred tabs) fall back to sniffing the
    // content, which is LF for anything the editor produced.
    lineEnding: encoding?.lineEnding ?? detectLineEnding(content),
    hasBom: encoding?.hasBom ?? false,
    diskFingerprint: null,
    dismissedFingerprint: null,
    fileMissing: false,
    scrollTop: 0,
    // Seed markdown documents with the configured default view; non-markdown
    // files always start in edit mode (the mode bar only renders for markdown).
    markdownViewMode: language === "markdown" ? defaultMarkdownViewMode : "edit",
  };
}

/** Applies disk open classification to an existing document (e.g. stale text PNG → image). */
export function documentWithOpenedFilePayload(
  documentState: DocumentState,
  filePath: string,
  content: string,
  contentKind: DocumentContentKind,
  encoding?: { lineEnding?: DocumentLineEnding; hasBom?: boolean },
): DocumentState {
  const normalizedContent =
    contentKind === "text" ? content : contentKind === "large_pending" ? "" : "";
  const kindChanged = documentState.contentKind !== contentKind;
  const shouldReplaceBuffer =
    kindChanged ||
    (contentKind !== "text" && contentKind !== "large_pending" && documentState.content.length > 0) ||
    (contentKind === "text" && !documentState.isDirty && documentState.content !== normalizedContent);

  if (!kindChanged && !shouldReplaceBuffer) {
    return documentState;
  }

  const nextContent = shouldReplaceBuffer || kindChanged ? normalizedContent : documentState.content;
  const nextSaved = shouldReplaceBuffer || kindChanged ? normalizedContent : documentState.savedContent;

  return {
    ...documentState,
    filePath,
    title: basename(filePath),
    contentKind,
    language: inferLanguage(filePath),
    content: nextContent,
    savedContent: nextSaved,
    isDirty:
      contentKind === "text" ? (kindChanged ? false : documentState.isDirty) : false,
    lineEnding: encoding?.lineEnding ?? documentState.lineEnding,
    hasBom: encoding?.hasBom ?? documentState.hasBom,
    markdownViewMode:
      contentKind === "text" ? documentState.markdownViewMode : "edit",
    scrollTop: kindChanged ? 0 : documentState.scrollTop,
  };
}

export function normalizeDocument(documentState: DocumentState): DocumentState {
  const markdownViewMode =
    documentState.markdownViewMode === "split" || documentState.markdownViewMode === "preview"
      ? documentState.markdownViewMode
      : "edit";
  const contentKind =
    documentState.contentKind === "image" ||
    documentState.contentKind === "binary" ||
    documentState.contentKind === "large_pending"
      ? documentState.contentKind
      : "text";
  return {
    ...documentState,
    contentKind,
    diskFingerprint: documentState.diskFingerprint ?? null,
    dismissedFingerprint: documentState.dismissedFingerprint ?? null,
    fileMissing: documentState.fileMissing ?? false,
    scrollTop: documentState.scrollTop ?? 0,
    lineEnding: documentState.lineEnding === "crlf" ? "crlf" : "lf",
    hasBom: documentState.hasBom ?? false,
    markdownViewMode,
  };
}
