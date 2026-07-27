import type {
  AppDomainState,
  AppSessionSnapshot,
  DocumentState,
  WindowSessionSnapshot,
} from "../domain/contracts";
import { stripWindowSnapshotForSession } from "./sessionDocumentPersistence";

export function toWindowSnapshot(state: AppDomainState): WindowSessionSnapshot {
  return stripWindowSnapshotForSession({
    activeContextId: state.contexts.activeContextId,
    notepad: state.contexts.notepad,
    chatHttp: state.contexts.chatHttp,
    workspaces: state.contexts.workspaces,
    editorPreferences: {
      zoomPercent: state.editor.zoomPercent,
      wrapLines: state.editor.wrapLines,
    },
    activityRailWidthPx: state.activityRailWidthPx,
  });
}

export function createEmptySessionSnapshot(): AppSessionSnapshot {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    lastActiveWindowId: "main",
    openFileRegistry: {},
    recentFiles: [],
    windows: {},
  };
}

export function decodeSessionSnapshot(raw: string): AppSessionSnapshot | null {
  const parsed = JSON.parse(raw) as AppSessionSnapshot;
  if (parsed.version !== 2 || !parsed.windows) {
    return null;
  }
  return {
    ...createEmptySessionSnapshot(),
    ...parsed,
    openFileRegistry: parsed.openFileRegistry ?? {},
    recentFiles: parsed.recentFiles ?? [],
  };
}

export function encodeSessionSnapshot(snapshot: AppSessionSnapshot): string {
  // Compact JSON — pretty-printing nearly doubles session I/O for large open buffers.
  return JSON.stringify(snapshot);
}

export function normalizeRestoredDocument(documentState: DocumentState): DocumentState {
  const content = documentState.content ?? "";
  const isDirty = documentState.isDirty ?? false;
  // Clean docs may omit a duplicate savedContent on disk (empty sentinel).
  const savedContent =
    !isDirty && (documentState.savedContent === undefined || documentState.savedContent === "")
      ? content
      : (documentState.savedContent ?? "");
  return {
    ...documentState,
    content,
    savedContent,
    isDirty,
    diskFingerprint: documentState.diskFingerprint ?? null,
    dismissedFingerprint: documentState.dismissedFingerprint ?? null,
    fileMissing: documentState.fileMissing ?? false,
    scrollTop: documentState.scrollTop ?? 0,
    markdownViewMode:
      documentState.markdownViewMode === "split" || documentState.markdownViewMode === "preview"
        ? documentState.markdownViewMode
        : "edit",
    contentKind:
      documentState.contentKind === "image" ||
      documentState.contentKind === "binary" ||
      documentState.contentKind === "large_pending"
        ? documentState.contentKind
        : "text",
  };
}
