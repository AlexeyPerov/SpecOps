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
  /** When true, tab is omitted from the strip until the document has content. */
  stripHidden?: boolean;
}

export interface SessionTabState {
  id: string;
  kind: "session";
  sessionId: string;
  pinned: boolean;
}

/**
 * A non-document, non-session editor-pane tab. View tabs render a chrome-less
 * surface such as Settings or Themes inside the editor pane (they are opened
 * as notepad tabs rather than as popups/panels).
 *
 * `subTab` carries an optional target within the view — e.g. a settings
 * section id for deep links from elsewhere in the app.
 */
export interface ViewTabState {
  id: string;
  kind: "view";
  view: "settings" | "themes" | "workspace-settings" | "workspace-manager" | "version-control";
  pinned: boolean;
  subTab?: string;
}

export type TabState = FileTabState | SessionTabState | ViewTabState;

export function isFileTab(tab: TabState): tab is FileTabState {
  return tab.kind === "file";
}

export function isSessionTab(tab: TabState): tab is SessionTabState {
  return tab.kind === "session";
}

export function isViewTab(tab: TabState): tab is ViewTabState {
  return tab.kind === "view";
}

export function createFileTab(
  id: string,
  documentId: string,
  pinned = false,
  stripHidden = false,
): FileTabState {
  return stripHidden ? { id, kind: "file", documentId, pinned, stripHidden: true } : { id, kind: "file", documentId, pinned };
}

export function createSessionTab(id: string, sessionId: string, pinned = false): SessionTabState {
  return { id, kind: "session", sessionId, pinned };
}

export function createViewTab(
  id: string,
  view: "settings" | "themes" | "workspace-settings" | "workspace-manager" | "version-control",
  pinned = false,
  subTab?: string,
): ViewTabState {
  return { id, kind: "view", view, pinned, ...(subTab ? { subTab } : {}) };
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
  tab:
    | TabState
    | (Omit<FileTabState, "kind"> & {
        kind?: unknown;
        sessionId?: unknown;
        agentId?: unknown;
        view?: unknown;
        subTab?: unknown;
      }),
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
  if (
    tab.kind === "view" &&
    (tab.view === "settings" ||
      tab.view === "themes" ||
      tab.view === "workspace-settings" ||
      tab.view === "workspace-manager" ||
      tab.view === "version-control")
  ) {
    const subTab = typeof tab.subTab === "string" ? tab.subTab : undefined;
    return createViewTab(tab.id, tab.view, tab.pinned ?? false, subTab);
  }
  if ("documentId" in tab && typeof tab.documentId === "string") {
    const fileTab = tab as Omit<FileTabState, "kind"> & { kind?: unknown };
    const stripHidden = fileTab.stripHidden === true;
    return createFileTab(tab.id, tab.documentId, tab.pinned ?? false, stripHidden);
  }
  throw new Error(`Invalid tab state: ${tab.id}`);
}

export function tabDocumentId(
  tab:
    | TabState
    | (Omit<FileTabState, "kind"> & {
        kind?: unknown;
        sessionId?: unknown;
        agentId?: unknown;
        view?: unknown;
        subTab?: unknown;
      })
    | undefined
    | null,
): string | null {
  if (!tab) {
    return null;
  }
  const normalized = normalizeTabState(tab);
  return isFileTab(normalized) ? normalized.documentId : null;
}
