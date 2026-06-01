import type { DocumentIdentity, DocumentState } from "../../domain/contracts";
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

export function buildDocument(identity: DocumentIdentity, content: string, title: string): DocumentState {
  return {
    id: identity.id,
    filePath: identity.filePath,
    title,
    content,
    savedContent: content,
    isDirty: false,
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

export function normalizeDocument(documentState: DocumentState): DocumentState {
  const markdownViewMode =
    documentState.markdownViewMode === "split" || documentState.markdownViewMode === "preview"
      ? documentState.markdownViewMode
      : "edit";
  return {
    ...documentState,
    diskFingerprint: documentState.diskFingerprint ?? null,
    dismissedFingerprint: documentState.dismissedFingerprint ?? null,
    fileMissing: documentState.fileMissing ?? false,
    scrollTop: documentState.scrollTop ?? 0,
    markdownViewMode,
  };
}
