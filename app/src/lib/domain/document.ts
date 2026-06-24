export interface DiskFingerprint {
  mtimeMs: number;
  sizeBytes: number;
}

export interface DocumentIdentity {
  id: string;
  filePath: string | null;
}

export type MarkdownViewMode = "edit" | "split" | "preview";

export type DocumentContentKind = "text" | "image" | "binary" | "large_pending";

export interface DocumentState extends DocumentIdentity {
  title: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  contentKind: DocumentContentKind;
  language: string;
  encoding: "utf-8";
  lineEnding: "lf" | "crlf";
  diskFingerprint: DiskFingerprint | null;
  dismissedFingerprint: DiskFingerprint | null;
  fileMissing: boolean;
  scrollTop: number;
  markdownViewMode: MarkdownViewMode;
}

export interface FileTabState {
  id: string;
  kind: "file";
  documentId: string;
  pinned: boolean;
}

export interface SessionTabState {
  id: string;
  kind: "session";
  sessionId: string;
  pinned: boolean;
}

export type TabState = FileTabState | SessionTabState;

export function isFileTab(tab: TabState): tab is FileTabState {
  return tab.kind === "file";
}

export function isSessionTab(tab: TabState): tab is SessionTabState {
  return tab.kind === "session";
}

export function createFileTab(id: string, documentId: string, pinned = false): FileTabState {
  return { id, kind: "file", documentId, pinned };
}

export function createSessionTab(id: string, sessionId: string, pinned = false): SessionTabState {
  return { id, kind: "session", sessionId, pinned };
}

/**
 * Restores legacy session tabs that omit `kind`.
 *
 * M16: the persisted `kind` discriminant is now `"session"` (renamed from the
 * pre-release `"agent"`). Pre-M16 snapshots used `"agent"` with an `agentId`
 * field; those legacy entries are normalized to the new session shape so a
 * stale window snapshot does not crash on first load (the on-disk chat layout
 * itself was reset by M16-T5 — see `specs/changelog.md`).
 */
export function normalizeTabState(
  tab: TabState | (Omit<FileTabState, "kind"> & { kind?: unknown; sessionId?: unknown; agentId?: unknown }),
): TabState {
  if (tab.kind === "session" && typeof tab.sessionId === "string") {
    return {
      id: tab.id,
      kind: "session",
      sessionId: tab.sessionId,
      pinned: tab.pinned ?? false,
    };
  }
  // Legacy pre-M16 agent tab → session tab.
  if (tab.kind === "agent" && typeof tab.agentId === "string") {
    return {
      id: tab.id,
      kind: "session",
      sessionId: tab.agentId,
      pinned: tab.pinned ?? false,
    };
  }
  if ("documentId" in tab && typeof tab.documentId === "string") {
    return createFileTab(tab.id, tab.documentId, tab.pinned ?? false);
  }
  throw new Error(`Invalid tab state: ${tab.id}`);
}

export function tabDocumentId(
  tab: TabState | (Omit<FileTabState, "kind"> & { kind?: unknown; sessionId?: unknown; agentId?: unknown }) | undefined,
): string | null {
  if (!tab) {
    return null;
  }
  const normalized = normalizeTabState(tab);
  return isFileTab(normalized) ? normalized.documentId : null;
}
