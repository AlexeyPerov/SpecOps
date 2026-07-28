import { readTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { atomicWriteTextFile } from "./atomicWrite";
import type {
  AppDomainState,
  AppSessionSnapshot,
  ContextSnapshot,
  OpenFileRegistry,
  WindowSessionSnapshot,
} from "../domain/contracts";
import {
  allTabs,
  isFileTab,
  tryNormalizeTabState,
  recomputeSelectedTabId,
} from "../domain/contracts";
import { normalizePathSync } from "./diskFingerprint";
import { ensureSpecOpsDataDir } from "./appDataDir";
import {
  createEmptySessionSnapshot,
  decodeSessionSnapshot,
  encodeSessionSnapshot,
} from "./sessionSnapshotCodec";
import { withSessionWriteLock } from "./sessionWriteLock";
import { logDiagnostic } from "./logging";

const SESSION_FILE = "session.json";

async function getSessionPath(): Promise<string> {
  const dataDir = await ensureSpecOpsDataDir();
  return join(dataDir, SESSION_FILE);
}

/**
 * Outcome of a session read for a read-modify-write.
 *
 * A failed read must NOT be papered over with an empty snapshot: an empty
 * `session.json` decodes cleanly, so `restoreWindowSession` returns null and never
 * falls back to the backup — one transient read failure (lock contention, a slow
 * network volume) would destroy every window's tabs and unsaved buffers with no
 * error surfaced. Callers therefore distinguish "no file yet" (safe to seed empty)
 * from "could not read the existing file" (must abort the RMW).
 */
type ReadResult =
  | { kind: "snapshot"; snapshot: AppSessionSnapshot }
  | { kind: "absent" }
  | { kind: "unreadable"; reason: string };

async function readSessionSnapshotForUpdate(): Promise<ReadResult> {
  const sessionPath = await getSessionPath();
  let raw: string;
  try {
    raw = await readTextFile(sessionPath);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    // "no such file" / ENOENT means this is the very first write — seeding an
    // empty snapshot is correct and loses nothing. Any other failure (EACCES,
    // EIO, lock contention, IPC error) means the file likely exists and holds
    // real data we must not overwrite.
    const lower = reason.toLowerCase();
    if (
      lower.includes("no such file") ||
      lower.includes("not found") ||
      lower.includes("os error 2")
    ) {
      return { kind: "absent" };
    }
    return { kind: "unreadable", reason };
  }
  const decoded = decodeSessionSnapshot(raw);
  if (decoded) {
    return { kind: "snapshot", snapshot: decoded };
  }
  // The file exists but did not decode. Overwriting it with an empty snapshot
  // would lose whatever is there (and the backup-promotion logic lives in
  // sessionManager, not here). Abort so sessionManager's restore can still
  // fall back to session.backup.json.
  return { kind: "unreadable", reason: "session.json failed to decode" };
}

async function writeSessionSnapshot(snapshot: AppSessionSnapshot): Promise<void> {
  const sessionPath = await getSessionPath();
  await atomicWriteTextFile(sessionPath, encodeSessionSnapshot(snapshot));
}

async function logAbortedUpdate(windowId: string, reason: string): Promise<void> {
  await logDiagnostic({
    level: "error",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "open-file registry update aborted: session.json unreadable",
    metadata: { windowId, reason },
  });
}

export function buildOpenFileRegistryForWindow(
  existing: OpenFileRegistry,
  windowId: string,
  state: AppDomainState,
): OpenFileRegistry {
  const registry: OpenFileRegistry = { ...existing };

  for (const [path, owner] of Object.entries(registry)) {
    if (owner.windowId === windowId) {
      delete registry[path];
    }
  }

  const contextSnapshots: ContextSnapshot[] = [
    state.contexts.notepad,
    ...state.contexts.workspaces.map((workspace) => workspace.snapshot),
  ];

  for (const contextSnapshot of contextSnapshots) {
    for (const rawTab of allTabs(contextSnapshot.session.editorLayout)) {
      const tab = tryNormalizeTabState(rawTab);
      if (!tab || !isFileTab(tab)) {
        continue;
      }
      const documentState = contextSnapshot.documents.find((doc) => doc.id === tab.documentId);
      if (!documentState?.filePath) {
        continue;
      }
      const key = normalizePathSync(documentState.filePath);
      registry[key] = {
        windowId,
        documentId: documentState.id,
      };
    }
  }

  return registry;
}

/**
 * Registry sync without acquiring the session write lock.
 * Call only from inside {@link withSessionWriteLock} (e.g. persistSessionSnapshot).
 */
export async function syncOpenFileRegistryForWindowUnlocked(
  windowId: string,
  state: AppDomainState,
): Promise<void> {
  const read = await readSessionSnapshotForUpdate();
  if (read.kind === "unreadable") {
    await logAbortedUpdate(windowId, read.reason);
    return;
  }
  const current = read.kind === "snapshot" ? read.snapshot : createEmptySessionSnapshot();
  const existingRegistry = read.kind === "snapshot" ? read.snapshot.openFileRegistry : {};
  current.openFileRegistry = buildOpenFileRegistryForWindow(existingRegistry, windowId, state);
  current.updatedAt = new Date().toISOString();
  await writeSessionSnapshot(current);
}

export async function readOpenFileRegistry(): Promise<OpenFileRegistry> {
  // Read-only: returning empty on a transient failure is acceptable (callers
  // treat an empty registry as "no owner yet"), unlike the RMW writers above
  // which must abort to avoid overwriting a good session.json.
  const read = await readSessionSnapshotForUpdate();
  return read.kind === "snapshot" ? read.snapshot.openFileRegistry : {};
}

export async function writeOpenFileRegistry(registry: OpenFileRegistry): Promise<void> {
  await withSessionWriteLock(async () => {
    const read = await readSessionSnapshotForUpdate();
    if (read.kind === "unreadable") {
      await logAbortedUpdate("unknown", read.reason);
      return;
    }
    const current = read.kind === "snapshot" ? read.snapshot : createEmptySessionSnapshot();
    current.openFileRegistry = registry;
    current.updatedAt = new Date().toISOString();
    await writeSessionSnapshot(current);
  });
}

export async function syncOpenFileRegistryForWindow(
  windowId: string,
  state: AppDomainState,
): Promise<void> {
  await withSessionWriteLock(() => syncOpenFileRegistryForWindowUnlocked(windowId, state));
}

export async function claimOpenFile(
  filePath: string,
  windowId: string,
  documentId: string,
): Promise<void> {
  if (!documentId) {
    return;
  }
  await withSessionWriteLock(async () => {
    const read = await readSessionSnapshotForUpdate();
    if (read.kind === "unreadable") {
      await logAbortedUpdate(windowId, read.reason);
      return;
    }
    const current = read.kind === "snapshot" ? read.snapshot : createEmptySessionSnapshot();
    const registry: OpenFileRegistry = { ...current.openFileRegistry };
    registry[normalizePathSync(filePath)] = { windowId, documentId };
    current.openFileRegistry = registry;
    current.updatedAt = new Date().toISOString();
    await writeSessionSnapshot(current);
  });
}

export function applyRegistryDedupeToWindowSnapshot(
  registry: OpenFileRegistry,
  windowId: string,
  snapshot: WindowSessionSnapshot,
): { registry: OpenFileRegistry; snapshot: WindowSessionSnapshot } {
  const nextRegistry = { ...registry };
  function dedupeContext(context: ContextSnapshot): ContextSnapshot {
    const documentsById = new Map(context.documents.map((doc) => [doc.id, doc]));
    const layout = context.session.editorLayout;
    let layoutChanged = false;

    const panes = layout.panes.map((pane) => {
      const retainedTabs = [];
      for (const rawTab of pane.tabs) {
        const tab = tryNormalizeTabState(rawTab);
        if (!tab) {
          layoutChanged = true;
          continue;
        }
        if (!isFileTab(tab)) {
          retainedTabs.push(tab);
          continue;
        }
        const linkedDocument = documentsById.get(tab.documentId);
        if (!linkedDocument?.filePath) {
          retainedTabs.push(tab);
          continue;
        }

        const key = normalizePathSync(linkedDocument.filePath);
        const owner = nextRegistry[key];
        if (owner && owner.windowId !== windowId) {
          layoutChanged = true;
          continue;
        }

        nextRegistry[key] = { windowId, documentId: linkedDocument.id };
        retainedTabs.push(tab);
      }

      const selectedTabId = recomputeSelectedTabId(
        pane.tabs,
        retainedTabs,
        pane.selectedTabId,
      );
      if (
        retainedTabs.length !== pane.tabs.length ||
        selectedTabId !== pane.selectedTabId
      ) {
        layoutChanged = true;
      }
      return { ...pane, tabs: retainedTabs, selectedTabId };
    });

    const referencedDocIds = new Set(
      allTabs({ ...layout, panes })
        .filter(isFileTab)
        .map((tab) => tab.documentId),
    );
    const documents = context.documents.filter((doc) => referencedDocIds.has(doc.id));

    return {
      documents,
      session: {
        ...context.session,
        editorLayout: layoutChanged ? { ...layout, panes } : layout,
      },
    };
  }

  const nextNotepad = dedupeContext(snapshot.notepad);
  const nextWorkspaces = snapshot.workspaces.map((workspace) => ({
    ...workspace,
    snapshot: dedupeContext(workspace.snapshot),
  }));
  const activeContextExists =
    snapshot.activeContextId === "notepad" ||
    nextWorkspaces.some((workspace) => workspace.id === snapshot.activeContextId);
  const nextActiveContextId = activeContextExists ? snapshot.activeContextId : "notepad";

  return {
    registry: nextRegistry,
    snapshot: {
      ...snapshot,
      activeContextId: nextActiveContextId,
      notepad: nextNotepad,
      workspaces: nextWorkspaces,
    },
  };
}

export async function dedupeWindowSnapshotAgainstRegistry(
  windowId: string,
  snapshot: WindowSessionSnapshot,
): Promise<WindowSessionSnapshot> {
  return withSessionWriteLock(async () => {
    const read = await readSessionSnapshotForUpdate();
    // When the session can't be read, still return the (un-deduped) snapshot so
    // the caller's restore proceeds with its own tabs intact; just skip the
    // registry write that would otherwise overwrite an unreadable session.json.
    const registry = read.kind === "snapshot" ? read.snapshot.openFileRegistry : {};
    const { registry: nextRegistry, snapshot: nextSnapshot } =
      applyRegistryDedupeToWindowSnapshot(registry, windowId, snapshot);

    if (read.kind === "unreadable") {
      await logAbortedUpdate(windowId, read.reason);
      return nextSnapshot;
    }

    const current = read.kind === "snapshot" ? read.snapshot : createEmptySessionSnapshot();
    current.openFileRegistry = nextRegistry;
    current.updatedAt = new Date().toISOString();
    await writeSessionSnapshot(current);

    return nextSnapshot;
  });
}

export async function releaseAllOpenFilesForWindow(windowId: string): Promise<void> {
  await withSessionWriteLock(async () => {
    const read = await readSessionSnapshotForUpdate();
    if (read.kind !== "snapshot") {
      if (read.kind === "unreadable") {
        await logAbortedUpdate(windowId, read.reason);
      }
      return;
    }
    const session = read.snapshot;
    const registry = { ...session.openFileRegistry };
    let changed = false;

    for (const [path, owner] of Object.entries(registry)) {
      if (owner.windowId === windowId) {
        delete registry[path];
        changed = true;
      }
    }

    if (changed) {
      session.openFileRegistry = registry;
      session.updatedAt = new Date().toISOString();
      await writeSessionSnapshot(session);
    }
  });
}

export async function renameOpenFileRegistry(
  oldPath: string | null,
  newPath: string,
  windowId: string,
  documentId: string,
): Promise<void> {
  await withSessionWriteLock(async () => {
    const read = await readSessionSnapshotForUpdate();
    if (read.kind === "unreadable") {
      await logAbortedUpdate(windowId, read.reason);
      return;
    }
    const current = read.kind === "snapshot" ? read.snapshot : createEmptySessionSnapshot();
    const registry: OpenFileRegistry = { ...current.openFileRegistry };
    if (oldPath) {
      delete registry[normalizePathSync(oldPath)];
    }
    registry[normalizePathSync(newPath)] = { windowId, documentId };
    current.openFileRegistry = registry;
    current.updatedAt = new Date().toISOString();
    await writeSessionSnapshot(current);
  });
}
