import type { DocumentContentKind, DocumentIdentity, DocumentState } from "../../domain/contracts";
import { inferEditorLanguage } from "../../editor/editorLanguage";
import { emptyUnsavedDocumentTitle } from "../../services/untitledDocument";

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
): DocumentState {
  return {
    id: identity.id,
    filePath: identity.filePath,
    title,
    content,
    savedContent: content,
    isDirty: false,
    contentKind,
    language: inferLanguage(identity.filePath),
    encoding: "utf-8",
    lineEnding: content.includes("\r\n") ? "crlf" : "lf",
    diskFingerprint: null,
    dismissedFingerprint: null,
    fileMissing: false,
    scrollTop: 0,
    markdownViewMode: "edit",
  };
}

/** Applies disk open classification to an existing document (e.g. stale text PNG → image). */
export function documentWithOpenedFilePayload(
  documentState: DocumentState,
  filePath: string,
  content: string,
  contentKind: DocumentContentKind,
): DocumentState {
  const normalizedContent = contentKind === "text" ? content : "";
  const kindChanged = documentState.contentKind !== contentKind;
  const shouldReplaceBuffer =
    kindChanged ||
    (contentKind !== "text" && documentState.content.length > 0) ||
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
    lineEnding: (nextContent.includes("\r\n") ? "crlf" : "lf") as "lf" | "crlf",
    markdownViewMode: contentKind === "text" ? documentState.markdownViewMode : "edit",
    scrollTop: kindChanged ? 0 : documentState.scrollTop,
  };
}

export function normalizeDocument(documentState: DocumentState): DocumentState {
  const markdownViewMode =
    documentState.markdownViewMode === "split" || documentState.markdownViewMode === "preview"
      ? documentState.markdownViewMode
      : "edit";
  const contentKind =
    documentState.contentKind === "image" || documentState.contentKind === "binary"
      ? documentState.contentKind
      : "text";
  return {
    ...documentState,
    contentKind,
    diskFingerprint: documentState.diskFingerprint ?? null,
    dismissedFingerprint: documentState.dismissedFingerprint ?? null,
    fileMissing: documentState.fileMissing ?? false,
    scrollTop: documentState.scrollTop ?? 0,
    markdownViewMode,
  };
}
