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
  return JSON.stringify(snapshot, null, 2);
}

export function normalizeRestoredDocument(documentState: DocumentState): DocumentState {
  return {
    ...documentState,
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
