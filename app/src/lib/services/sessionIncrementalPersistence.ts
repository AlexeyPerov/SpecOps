import { readDir, readTextFile, remove } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type {
  AppDomainState,
  ContextId,
  ContextSnapshot,
  DocumentState,
  EditorLayout,
  WindowSessionSnapshot,
} from "../domain/contracts";
import { isFileTab } from "../domain/contracts";
import { ensureSpecOpsDataDir } from "./appDataDir";
import { atomicWriteTextFile } from "./atomicWrite";
import { toWindowSnapshot } from "./sessionSnapshotCodec";
import { enqueueSessionWriteInWindow } from "./sessionWriteLock";
import { logDiagnostic } from "./logging";

const NAVIGATION_VERSION = 1;
const BUFFER_VERSION = 1;

type NavigationRecord = {
  version: typeof NAVIGATION_VERSION;
  windowId: string;
  updatedAt: string;
  snapshot: WindowSessionSnapshot;
};

type BufferRecord = {
  version: typeof BUFFER_VERSION;
  windowId: string;
  contextId: ContextId;
  documentId: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
};

type ContextEntry = {
  contextId: ContextId;
  snapshot: ContextSnapshot;
};

/**
 * Per-window navigation fingerprint (P03-08-25). A cheap structural key over
 * topology + metadata that excludes document content, so a debounced persist
 * no longer maps every document in every context twice and `JSON.stringify`s
 * the whole snapshot just to decide nothing changed.
 */
const navigationFingerprintByWindow = new Map<string, string>();
/**
 * Per-document buffer fingerprint (P03-08-26). Stores a djb2 hash + length of
 * the content instead of the content itself, so the cache no longer retains
 * the full text of every document ever persisted for the session.
 */
const bufferFingerprintByKey = new Map<string, string>();

function safeFilePart(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

async function navigationPath(windowId: string): Promise<string> {
  return join(await ensureSpecOpsDataDir(), `session-navigation.${safeFilePart(windowId)}.json`);
}

/**
 * List every `session-buffer.<windowId>.*.json` file in the data dir. Cleanup
 * enumerates by filename prefix rather than by parsing the navigation record:
 * if the navigation file is missing or corrupt, the buffer files would
 * otherwise leak forever (and could be rehydrated by a window that reuses the
 * label).
 */
async function listBufferFilesForWindow(windowId: string): Promise<string[]> {
  const dataDir = await ensureSpecOpsDataDir();
  const prefix = `session-buffer.${safeFilePart(windowId)}.`;
  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    entries = await readDir(dataDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile && entry.name.startsWith(prefix) && entry.name.endsWith(".json"))
    .map((entry) => entry.name);
}

async function bufferPath(
  windowId: string,
  contextId: ContextId,
  documentId: string,
): Promise<string> {
  return join(
    await ensureSpecOpsDataDir(),
    `session-buffer.${safeFilePart(windowId)}.${safeFilePart(contextId)}.${safeFilePart(documentId)}.json`,
  );
}

function contextEntries(snapshot: WindowSessionSnapshot): ContextEntry[] {
  return [
    { contextId: "notepad", snapshot: snapshot.notepad },
    { contextId: "chat-http", snapshot: snapshot.chatHttp ?? snapshot.notepad },
    ...(snapshot.chatCloud
      ? [{ contextId: "chat-cloud" as const, snapshot: snapshot.chatCloud }]
      : []),
    ...snapshot.workspaces.map((workspace) => ({
      contextId: workspace.id,
      snapshot: workspace.snapshot,
    })),
  ];
}

/**
 * Build the navigation record payload while stripping per-document buffers in
 * the same pass that walks each context (P03-08-25): the previous code mapped
 * every document twice — once through `toWindowSnapshot`/`stripWindowSnapshot…`
 * (which only clears content for image/binary/clean docs) and again through
 * `stripBufferPayload` (which clears all content for the nav record). Now each
 * document is visited once and its content fields are blanked directly on the
 * nav-record copy, while the full content is read off the original for the
 * buffer fingerprint in the same loop.
 */
function buildNavigationSnapshot(snapshot: WindowSessionSnapshot): WindowSessionSnapshot {
  const stripContextDocuments = (context: ContextSnapshot): ContextSnapshot => ({
    ...context,
    documents: context.documents.map((documentState) => ({
      ...documentState,
      content: "",
      savedContent: "",
    })),
  });
  return {
    ...snapshot,
    notepad: stripContextDocuments(snapshot.notepad),
    chatHttp: stripContextDocuments(snapshot.chatHttp ?? snapshot.notepad),
    ...(snapshot.chatCloud
      ? { chatCloud: stripContextDocuments(snapshot.chatCloud) }
      : {}),
    workspaces: snapshot.workspaces.map((workspace) => ({
      ...workspace,
      snapshot: stripContextDocuments(workspace.snapshot),
    })),
  };
}

function bufferKey(windowId: string, contextId: ContextId, documentId: string): string {
  return `${windowId}\0${contextId}\0${documentId}`;
}

/**
 * Cheap content fingerprint (P03-08-26): a stable djb2 hash plus the length.
 * Collisions on different edits of the same length are possible (~1 in 2^32)
 * but benign — a stale hash would skip one buffer rewrite, and the very next
 * edit (almost certainly a different length) re-syncs it. The point is that
 * the map no longer retains the full text of every persisted document.
 */
function contentFingerprint(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i += 1) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) >>> 0;
  }
  return `${hash.toString(36)}:${content.length}`;
}

/**
 * Fingerprint the navigation topology + metadata without materializing any
 * document content (P03-08-25). The key is built from the fields that
 * constitute "the window shape": active context, per-context document list
 * (id/title/path/dirty/kind), the editor layout (panes/tabs/selection), and
 * the scalar preferences. Content and saved content are deliberately excluded
 * — they live in the per-document buffer files.
 */
function navigationFingerprint(snapshot: WindowSessionSnapshot): string {
  const parts: string[] = [snapshot.activeContextId];
  parts.push(
    `zoom=${snapshot.editorPreferences.zoomPercent}`,
    `wrap=${snapshot.editorPreferences.wrapLines ? 1 : 0}`,
    `rail=${snapshot.activityRailWidthPx ?? 0}`,
  );
  const emitContext = (contextId: string, context: ContextSnapshot): void => {
    parts.push(`|ctx=${contextId}|`);
    for (const doc of context.documents) {
      parts.push(
        doc.id,
        doc.title,
        doc.filePath ?? "",
        doc.isDirty ? "D" : "C",
        doc.contentKind,
        doc.language,
        doc.fileMissing ? "M" : "_",
        String(doc.markdownViewMode),
      );
    }
    parts.push(layoutFingerprint(context.session.editorLayout));
    if (context.session.lastActiveSessionId !== undefined) {
      parts.push(`las=${context.session.lastActiveSessionId ?? ""}`);
    }
    if (context.session.layout) {
      const l = context.session.layout;
      // Include the expanded project-tree paths so a folder toggle triggers a
      // snapshot write. Sorted/deduped for determinism; paths are joined with a
      // separator that cannot appear inside a normalized path.
      const expanded = [...new Set(l.expandedProjectTreePaths ?? [])]
        .filter((path) => typeof path === "string")
        .sort()
        .join("\u0002");
      parts.push(
        `lay=${l.projectPanelWidthPx}:${l.sessionsSidebarWidthPx}:${l.projectPanelCollapsed ? 1 : 0}:${l.sessionsSidebarCollapsed ? 1 : 0}:e=${expanded}`,
      );
    }
  };
  emitContext("notepad", snapshot.notepad);
  if (snapshot.chatHttp) {
    emitContext("chat-http", snapshot.chatHttp);
  }
  if (snapshot.chatCloud) {
    emitContext("chat-cloud", snapshot.chatCloud);
  }
  for (const workspace of snapshot.workspaces) {
    parts.push(`#ws=${workspace.id}@${workspace.rootPath}`);
    emitContext(workspace.id, workspace.snapshot);
  }
  return parts.join("\u0001");
}

function layoutFingerprint(layout: EditorLayout): string {
  const panes = layout.panes
    .map((pane) =>
      [
        pane.id,
        pane.selectedTabId ?? "",
        pane.tabs
          .map((tab) =>
            isFileTab(tab)
              ? `f:${tab.documentId}:${tab.pinned ? 1 : 0}${tab.stripHidden ? "h" : ""}`
              : tab.kind === "session"
                ? `s:${tab.sessionId}:${tab.pinned ? 1 : 0}`
                : `v:${tab.view}:${tab.pinned ? 1 : 0}${tab.subTab ? `:${tab.subTab}` : ""}`,
          )
          .join(","),
      ].join(">"),
    )
    .join("|");
  const slots = layout.slots.map((row) => row.join(".")).join("/");
  return `L=${layout.kind}:${layout.activePaneId}[${panes}][${slots}]`;
}

/**
 * Persist lightweight topology and only document buffers whose payload changed.
 * Buffer files are written first, so a navigation record never points at a
 * revision that was not durably written yet.
 */
export async function persistIncrementalWindowSession(
  state: AppDomainState,
  windowId: string,
): Promise<void> {
  const fullSnapshot = toWindowSnapshot(state);
  const navFingerprint = navigationFingerprint(fullSnapshot);
  const navigationChanged = navigationFingerprintByWindow.get(windowId) !== navFingerprint;

  // Single pass over every document: detect changed buffers, prune buffer
  // files + fingerprint entries for documents that no longer exist in any
  // context (closed tabs — P03-08-26), and record live keys. `toWindowSnapshot`
  // already strips image/binary content via `stripWindowSnapshotForSession`;
  // those documents are skipped because their persisted `content` is blank and
  // blank content has nothing to buffer.
  const changedBuffers: Array<{ record: BufferRecord; fingerprint: string }> = [];
  const liveKeys = new Set<string>();
  let liveBufferCount = 0;
  for (const context of contextEntries(fullSnapshot)) {
    for (const documentState of context.snapshot.documents) {
      const key = bufferKey(windowId, context.contextId, documentState.id);
      liveKeys.add(key);
      if (documentState.content.length === 0) {
        // Nothing to buffer for a stripped/empty document. If an older buffer
        // file exists (document emptied by a save), rewrite is cheap but the
        // fingerprint must still advance so a later non-empty edit persists.
        continue;
      }
      liveBufferCount += 1;
      const fingerprint = contentFingerprint(documentState.content);
      if (bufferFingerprintByKey.get(key) !== fingerprint) {
        changedBuffers.push({
          record: {
            version: BUFFER_VERSION,
            windowId,
            contextId: context.contextId,
            documentId: documentState.id,
            content: documentState.content,
            savedContent: documentState.savedContent,
            isDirty: documentState.isDirty,
          },
          fingerprint,
        });
      }
    }
  }

  // Evict buffer files + fingerprint entries for documents that were closed in
  // this window (P03-08-26): previously the map retained the full text (now a
  // hash) of every document ever opened until the window session was removed
  // entirely, and the per-document `session-buffer.*.json` files were never
  // deleted on tab close — growing the data dir and the restore `readDir`.
  const staleKeys: string[] = [];
  for (const key of bufferFingerprintByKey.keys()) {
    if (key.startsWith(`${windowId}\0`) && !liveKeys.has(key)) {
      staleKeys.push(key);
    }
  }

  // On-disk orphan sweep (P03-08-26): the in-memory `staleKeys` only cover
  // documents the cache already tracks. After a crash/restart the cache is
  // empty, so stale buffer files for closed documents would survive until the
  // whole window session is removed. Run the sweep only when the in-memory
  // cache has no entries for this window yet (the cold/post-crash state): once
  // warm, the `staleKeys` path already covers deletions and a `readDir` per
  // persist would be pure cost. The set of expected buffer filenames is built
  // from the live keys; any on-disk file for this window not in the set is an
  // orphan and is deleted.
  const hasInMemoryEntriesForWindow = Array.from(bufferFingerprintByKey.keys()).some((key) =>
    key.startsWith(`${windowId}\0`),
  );
  const needsOnDiskOrphanSweep = !hasInMemoryEntriesForWindow;
  const windowIdPart = safeFilePart(windowId);
  const liveBufferFileNames = needsOnDiskOrphanSweep ? new Set<string>() : null;
  if (liveBufferFileNames) {
    for (const key of liveKeys) {
      const [, contextId, documentId] = key.split("\u0000") as [string, ContextId, string];
      liveBufferFileNames.add(
        `session-buffer.${windowIdPart}.${safeFilePart(contextId)}.${safeFilePart(documentId)}.json`,
      );
    }
  }

  if (
    !navigationChanged &&
    changedBuffers.length === 0 &&
    staleKeys.length === 0 &&
    !needsOnDiskOrphanSweep
  ) {
    return;
  }

  // P03-08-25: the navigation + buffer files are keyed by `windowId`, whose
  // only writer is this window by construction, and the writes are atomic
  // (temp + rename). The cross-window mkdir/owner/stat/remove lock IPC was
  // pure cost here. The shared in-window chain still orders these writes
  // against each other and against `session.json` writes (which take the
  // cross-window lock), and the watchdog still bounds a hung write.
  await enqueueSessionWriteInWindow(async () => {
    for (const { record, fingerprint } of changedBuffers) {
      await atomicWriteTextFile(
        await bufferPath(windowId, record.contextId, record.documentId),
        JSON.stringify(record),
      );
      bufferFingerprintByKey.set(
        bufferKey(windowId, record.contextId, record.documentId),
        fingerprint,
      );
    }

    // Delete buffer files for closed documents and drop their fingerprint
    // entries so the cache cannot outlive the document.
    for (const key of staleKeys) {
      const [, contextId, documentId] = key.split("\u0000") as [string, ContextId, string];
      try {
        await remove(await bufferPath(windowId, contextId, documentId));
      } catch {
        // Already absent — a concurrent persist or external cleanup removed it.
      }
      bufferFingerprintByKey.delete(key);
    }

    // On-disk orphan sweep (P03-08-26): delete buffer files for this window that
    // are not in the live set. This handles crash-restart residue the in-memory
    // cache cannot know about (the cache is empty after a restart). Only runs in
    // the cold-cache state to avoid a `readDir` on every persist.
    if (needsOnDiskOrphanSweep && liveBufferFileNames) {
      const dataDir = await ensureSpecOpsDataDir();
      let orphanNames: string[];
      try {
        orphanNames = await listBufferFilesForWindow(windowId);
      } catch {
        orphanNames = [];
      }
      for (const name of orphanNames) {
        if (liveBufferFileNames.has(name)) {
          continue;
        }
        try {
          await remove(await join(dataDir, name));
        } catch {
          // Already absent — a concurrent persist or external cleanup removed it.
        }
      }
    }

    if (navigationChanged) {
      const navigationSnapshot = buildNavigationSnapshot(fullSnapshot);
      const navigation: NavigationRecord = {
        version: NAVIGATION_VERSION,
        windowId,
        updatedAt: new Date().toISOString(),
        snapshot: navigationSnapshot,
      };
      await atomicWriteTextFile(await navigationPath(windowId), JSON.stringify(navigation));
      navigationFingerprintByWindow.set(windowId, navFingerprint);
    }
  });

  // Light, contention-free metric so the eviction path is observable in logs
  // without paying a stringify on every persist.
  if (staleKeys.length > 0) {
    void logDiagnostic({
      level: "debug",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "incremental session pruned closed-document buffers",
      metadata: { windowId, pruned: staleKeys.length, live: liveBufferCount },
    }).catch(() => {});
  }
}

function fallbackDocumentsByContext(
  fallback: WindowSessionSnapshot | null,
): Map<ContextId, Map<string, DocumentState>> {
  const result = new Map<ContextId, Map<string, DocumentState>>();
  if (!fallback) {
    return result;
  }
  for (const context of contextEntries(fallback)) {
    result.set(
      context.contextId,
      new Map(context.snapshot.documents.map((documentState) => [documentState.id, documentState])),
    );
  }
  return result;
}

async function hydrateContextBuffers(
  windowId: string,
  contextId: ContextId,
  context: ContextSnapshot,
  fallback: Map<string, DocumentState> | undefined,
): Promise<ContextSnapshot> {
  const documents = await Promise.all(
    context.documents.map(async (documentState) => {
      try {
        const raw = await readTextFile(await bufferPath(windowId, contextId, documentState.id));
        const parsed = JSON.parse(raw) as Partial<BufferRecord>;
        if (
          parsed.version === BUFFER_VERSION &&
          parsed.windowId === windowId &&
          parsed.contextId === contextId &&
          parsed.documentId === documentState.id &&
          typeof parsed.content === "string" &&
          typeof parsed.savedContent === "string" &&
          typeof parsed.isDirty === "boolean"
        ) {
          return {
            ...documentState,
            content: parsed.content,
            savedContent: parsed.savedContent,
            isDirty: parsed.isDirty,
          };
        }
      } catch {
        // A checkpoint document is the safe fallback for a missing/corrupt buffer record.
      }
      const checkpointDoc = fallback?.get(documentState.id);
      if (checkpointDoc) {
        return checkpointDoc;
      }
      // No checkpoint and no buffer: the navigation record carries stripped
      // (empty) content for this document. Restoring that verbatim would look
      // like a legitimate empty file and silently overwrite the user's real
      // file on the next save. Mark it missing so the save/external-change
      // flows re-resolve it instead of writing empty content.
      return { ...documentState, content: "", savedContent: "", isDirty: false, fileMissing: true };
    }),
  );
  return { ...context, documents };
}

/** Read the authoritative navigation record and join it with per-document buffers. */
export async function readIncrementalWindowSession(
  windowId: string,
  checkpoint: WindowSessionSnapshot | null,
): Promise<WindowSessionSnapshot | null> {
  let navigation: NavigationRecord;
  try {
    navigation = JSON.parse(await readTextFile(await navigationPath(windowId))) as NavigationRecord;
  } catch {
    return checkpoint;
  }
  if (
    navigation.version !== NAVIGATION_VERSION ||
    navigation.windowId !== windowId ||
    !navigation.snapshot?.notepad ||
    !Array.isArray(navigation.snapshot.workspaces)
  ) {
    return checkpoint;
  }
  const fallback = fallbackDocumentsByContext(checkpoint);
  const snapshot = navigation.snapshot;
  const notepad = await hydrateContextBuffers(
    windowId,
    "notepad",
    snapshot.notepad,
    fallback.get("notepad"),
  );
  const chatHttp = await hydrateContextBuffers(
    windowId,
    "chat-http",
    snapshot.chatHttp ?? snapshot.notepad,
    fallback.get("chat-http"),
  );
  const chatCloud = snapshot.chatCloud
    ? await hydrateContextBuffers(
        windowId,
        "chat-cloud",
        snapshot.chatCloud,
        fallback.get("chat-cloud"),
      )
    : undefined;
  const workspaces = await Promise.all(
    snapshot.workspaces.map(async (workspace) => ({
      ...workspace,
      snapshot: await hydrateContextBuffers(
        windowId,
        workspace.id,
        workspace.snapshot,
        fallback.get(workspace.id),
      ),
    })),
  );
  return {
    ...snapshot,
    notepad,
    chatHttp,
    ...(chatCloud ? { chatCloud } : {}),
    workspaces,
  };
}

export async function removeIncrementalWindowSession(windowId: string): Promise<void> {
  // Enumerate buffer files by filename prefix so a missing or corrupt
  // navigation record cannot strand buffer files on disk (which could otherwise
  // be rehydrated if a window label were ever reused).
  const dataDir = await ensureSpecOpsDataDir();
  const bufferFileNames = await listBufferFilesForWindow(windowId);
  await Promise.all(
    bufferFileNames.map(async (name) => {
      try {
        await remove(await join(dataDir, name));
      } catch {
        // Missing buffer record is already removed.
      }
    }),
  );
  try {
    await remove(await navigationPath(windowId));
  } catch {
    // Missing navigation record is already removed.
  }
  navigationFingerprintByWindow.delete(windowId);
  for (const key of bufferFingerprintByKey.keys()) {
    if (key.startsWith(`${windowId}\0`)) {
      bufferFingerprintByKey.delete(key);
    }
  }
}

export function resetIncrementalSessionPersistenceForTests(): void {
  navigationFingerprintByWindow.clear();
  bufferFingerprintByKey.clear();
}
