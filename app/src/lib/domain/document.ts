export interface DiskFingerprint {
  mtimeMs: number;
  sizeBytes: number;
  /**
   * Hex SHA-256 of the on-disk bytes, set when the fingerprint was taken from a
   * content read/write. Absent on metadata-only stats. Used to detect same-size
   * edits within a coarse mtime tick, and when mtime is unavailable.
   */
  contentHash?: string;
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
  /**
   * Line ending the file uses on disk. `content` is always LF (CodeMirror normalizes
   * its document to LF, so the store has to match or the two can never compare equal);
   * this is what the save path converts back to. Detected once at open and preserved
   * across saves rather than re-derived from the LF buffer.
   */
  lineEnding: "lf" | "crlf";
  /**
   * True when the file on disk starts with a UTF-8 BOM, which is restored on write.
   * Optional so buffers with no file behind them (and test fixtures) can omit it;
   * `normalizeDocument` coerces it and the save path defaults it to false.
   */
  hasBom?: boolean;
  diskFingerprint: DiskFingerprint | null;
  dismissedFingerprint: DiskFingerprint | null;
  fileMissing: boolean;
  scrollTop: number;
  markdownViewMode: MarkdownViewMode;
  /**
   * Per-document width of the centred text column, in CSS px. `null`/absent
   * means "use the app default" (`--editor-text-max-width`). Set by dragging
   * the column's edge handle in the editor; the free space either side of the
   * text follows from it, since the column stays centred.
   */
  textColumnWidthPx?: number | null;
}

/**
 * Bounds for {@link DocumentState.textColumnWidthPx}. The floor keeps the
 * column wide enough to stay editable; the ceiling is generous enough that any
 * realistic monitor hits the pane edge (which clamps it) before this.
 */
export const MIN_TEXT_COLUMN_WIDTH_PX = 240;
export const MAX_TEXT_COLUMN_WIDTH_PX = 8000;

/**
 * Coerces a persisted/user-supplied column width to a usable value. Anything
 * non-finite or non-positive collapses to `null` — the "use the app default"
 * sentinel — so a corrupt snapshot degrades to the token width.
 */
export function normalizeTextColumnWidthPx(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(
    Math.min(MAX_TEXT_COLUMN_WIDTH_PX, Math.max(MIN_TEXT_COLUMN_WIDTH_PX, value)),
  );
}

export interface FileTabState {
  id: string;
  kind: "file";
  documentId: string;
  pinned: boolean;
  /** When true, tab is omitted from the strip until the document has content. */
  stripHidden?: boolean;
  /**
   * Transient ("preview") tab: opened by a single click in the project tree and
   * reused by the next such click, so browsing files does not pile up tabs.
   * The flag is cleared — the tab becomes an ordinary one — as soon as the user
   * does something with the file (edits it, moves the caret, saves, renames,
   * pins, drags the tab, or double-clicks it). At most one transient tab exists
   * per pane. Deliberately not restored from a session snapshot: a tab that
   * survived a restart is one the user kept.
   */
  transient?: true;
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
  transient = false,
): FileTabState {
  const tab: FileTabState = { id, kind: "file", documentId, pinned };
  if (stripHidden) {
    tab.stripHidden = true;
  }
  if (transient) {
    tab.transient = true;
  }
  return tab;
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
export function tryNormalizeTabState(
  tab:
    | TabState
    | (Omit<FileTabState, "kind"> & {
        kind?: unknown;
        sessionId?: unknown;
        agentId?: unknown;
        view?: unknown;
        subTab?: unknown;
      }),
): TabState | null {
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
  return null;
}

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
  const normalized = tryNormalizeTabState(tab);
  if (!normalized) {
    throw new Error(`Invalid tab state: ${tab.id}`);
  }
  return normalized;
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
