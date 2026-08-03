import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { atomicWriteTextFile } from "./atomicWrite";
import type {
  AppDomainState,
  ContextSnapshot,
  OpenFileOwner,
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
import { withOpenFileRegistryLock } from "./sessionWriteLock";
import { logDiagnostic } from "./logging";

const OPEN_FILE_REGISTRY_FILE = "open-files.json";
const OPEN_FILE_REGISTRY_VERSION = 1 as const;
const OPEN_FILE_REGISTRY_CHANGED_EVENT = "spec-ops/open-files-changed";

interface OpenFileRegistrySnapshot {
  version: typeof OPEN_FILE_REGISTRY_VERSION;
  updatedAt: string;
  registry: OpenFileRegistry;
}

let cachedSnapshot: OpenFileRegistrySnapshot | null = null;
let registryListenerPromise: Promise<UnlistenFn | null> | null = null;

function decodeRegistrySnapshot(raw: string): OpenFileRegistrySnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Partial<OpenFileRegistrySnapshot>;
    if (
      parsed.version !== OPEN_FILE_REGISTRY_VERSION ||
      typeof parsed.updatedAt !== "string" ||
      !parsed.registry ||
      typeof parsed.registry !== "object" ||
      Array.isArray(parsed.registry)
    ) {
      return null;
    }
    const registry: OpenFileRegistry = {};
    for (const [path, owner] of Object.entries(parsed.registry)) {
      if (
        owner &&
        typeof owner === "object" &&
        typeof owner.windowId === "string" &&
        typeof owner.documentId === "string"
      ) {
        registry[normalizePathSync(path)] = {
          windowId: owner.windowId,
          documentId: owner.documentId,
        };
      }
    }
    return { version: OPEN_FILE_REGISTRY_VERSION, updatedAt: parsed.updatedAt, registry };
  } catch {
    return null;
  }
}

async function ensureRegistryChangeListener(): Promise<boolean> {
  if (registryListenerPromise) {
    return (await registryListenerPromise) !== null;
  }
  registryListenerPromise = listen<OpenFileRegistrySnapshot>(
    OPEN_FILE_REGISTRY_CHANGED_EVENT,
    (event) => {
      const snapshot = decodeRegistrySnapshot(JSON.stringify(event.payload));
      if (snapshot) {
        cachedSnapshot = snapshot;
      }
    },
  ).catch(() => null);
  return (await registryListenerPromise) !== null;
}

async function getRegistryPath(): Promise<string> {
  const dataDir = await ensureSpecOpsDataDir();
  return join(dataDir, OPEN_FILE_REGISTRY_FILE);
}

/**
 * Outcome of an ownership-registry read for a read-modify-write.
 *
 * A failed read must NOT be papered over with an empty snapshot: an empty
 * registry would make every path appear unowned, allowing multiple windows to
 * edit the same file. Callers therefore distinguish "no file yet" (safe to seed
 * empty) from "could not read the existing file" (must abort the RMW).
 */
type ReadResult =
  | { kind: "snapshot"; snapshot: OpenFileRegistrySnapshot }
  | { kind: "absent" }
  | { kind: "unreadable"; reason: string };

async function readRegistrySnapshotForUpdate(): Promise<ReadResult> {
  const registryPath = await getRegistryPath();
  let raw: string;
  try {
    raw = await readTextFile(registryPath);
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
  const decoded = decodeRegistrySnapshot(raw);
  if (decoded) {
    return { kind: "snapshot", snapshot: decoded };
  }
  // The file exists but did not decode. Overwriting it with an empty snapshot
  // would silently discard ownership and allow duplicate editors.
  return { kind: "unreadable", reason: "open-files.json failed to decode" };
}

async function writeRegistrySnapshot(registry: OpenFileRegistry): Promise<void> {
  const snapshot: OpenFileRegistrySnapshot = {
    version: OPEN_FILE_REGISTRY_VERSION,
    updatedAt: new Date().toISOString(),
    registry,
  };
  const registryPath = await getRegistryPath();
  await atomicWriteTextFile(registryPath, JSON.stringify(snapshot));
  cachedSnapshot = snapshot;
  void emit(OPEN_FILE_REGISTRY_CHANGED_EVENT, snapshot).catch(() => {});
}

async function logAbortedUpdate(windowId: string, reason: string): Promise<void> {
  await logDiagnostic({
    level: "error",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "open-file registry update aborted: open-files.json unreadable",
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

export async function readOpenFileRegistry(): Promise<OpenFileRegistry> {
  const hadListener = registryListenerPromise !== null;
  const listenerReady = await ensureRegistryChangeListener();
  // A cache created before the change listener existed may have missed another
  // window's event. Force one disk read after listener installation; subsequent
  // reads are event-coherent and can stay in memory.
  if (hadListener && listenerReady && cachedSnapshot) {
    return { ...cachedSnapshot.registry };
  }
  // Read-only: returning empty on a transient failure is acceptable (callers
  // treat an empty registry as "no owner yet"), unlike the RMW writers below
  // which must abort rather than replace an unreadable ownership record.
  const read = await readRegistrySnapshotForUpdate();
  if (read.kind !== "snapshot") {
    return {};
  }
  cachedSnapshot = read.snapshot;
  return { ...read.snapshot.registry };
}

export async function syncOpenFileRegistryForWindow(
  windowId: string,
  state: AppDomainState,
): Promise<void> {
  await withOpenFileRegistryLock(async () => {
    const read = await readRegistrySnapshotForUpdate();
    if (read.kind === "unreadable") {
      await logAbortedUpdate(windowId, read.reason);
      return;
    }
    const existingRegistry = read.kind === "snapshot" ? read.snapshot.registry : {};
    await writeRegistrySnapshot(
      buildOpenFileRegistryForWindow(existingRegistry, windowId, state),
    );
  });
}

export async function claimOpenFile(
  filePath: string,
  windowId: string,
  documentId: string,
): Promise<OpenFileOwner | null> {
  return withOpenFileRegistryLock(async () => {
    const read = await readRegistrySnapshotForUpdate();
    if (read.kind === "unreadable") {
      await logAbortedUpdate(windowId, read.reason);
      throw new Error(`Open-file ownership is unavailable: ${read.reason}`);
    }
    const registry: OpenFileRegistry = {
      ...(read.kind === "snapshot" ? read.snapshot.registry : {}),
    };
    const normalizedPath = normalizePathSync(filePath);
    const existing = registry[normalizedPath];
    if (existing && existing.windowId !== windowId) {
      return existing;
    }
    // Empty document id is an atomic reservation made before file I/O. Do not
    // erase an established same-window document id when re-requesting it.
    registry[normalizedPath] = {
      windowId,
      documentId: documentId || existing?.documentId || "",
    };
    await writeRegistrySnapshot(registry);
    return null;
  });
}

/** Release a failed pre-open reservation without touching established tabs. */
export async function releasePendingOpenFile(
  filePath: string,
  windowId: string,
): Promise<void> {
  await withOpenFileRegistryLock(async () => {
    const read = await readRegistrySnapshotForUpdate();
    if (read.kind !== "snapshot") {
      return;
    }
    const normalizedPath = normalizePathSync(filePath);
    const owner = read.snapshot.registry[normalizedPath];
    if (!owner || owner.windowId !== windowId || owner.documentId !== "") {
      return;
    }
    const registry = { ...read.snapshot.registry };
    delete registry[normalizedPath];
    await writeRegistrySnapshot(registry);
  });
}

/** Atomically hand ownership from a source window to a transfer target. */
export async function transferOpenFileClaim(
  filePath: string,
  sourceWindowId: string,
  targetWindowId: string,
  documentId: string,
): Promise<OpenFileOwner | null> {
  return withOpenFileRegistryLock(async () => {
    const read = await readRegistrySnapshotForUpdate();
    if (read.kind === "unreadable") {
      await logAbortedUpdate(targetWindowId, read.reason);
      throw new Error(`Open-file ownership is unavailable: ${read.reason}`);
    }
    const registry: OpenFileRegistry = {
      ...(read.kind === "snapshot" ? read.snapshot.registry : {}),
    };
    const normalizedPath = normalizePathSync(filePath);
    const existing = registry[normalizedPath];
    if (
      existing &&
      existing.windowId !== sourceWindowId &&
      existing.windowId !== targetWindowId
    ) {
      return existing;
    }
    registry[normalizedPath] = { windowId: targetWindowId, documentId };
    await writeRegistrySnapshot(registry);
    return null;
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
  return withOpenFileRegistryLock(async () => {
    const read = await readRegistrySnapshotForUpdate();
    // When the registry can't be read, still return the (un-deduped) snapshot so
    // the caller's restore proceeds with its own tabs intact; just skip the
    // registry write that would otherwise overwrite an unreadable record.
    const registry = read.kind === "snapshot" ? read.snapshot.registry : {};
    const { registry: nextRegistry, snapshot: nextSnapshot } =
      applyRegistryDedupeToWindowSnapshot(registry, windowId, snapshot);

    if (read.kind === "unreadable") {
      await logAbortedUpdate(windowId, read.reason);
      return nextSnapshot;
    }

    await writeRegistrySnapshot(nextRegistry);

    return nextSnapshot;
  });
}

export async function releaseAllOpenFilesForWindow(windowId: string): Promise<void> {
  await withOpenFileRegistryLock(async () => {
    const read = await readRegistrySnapshotForUpdate();
    if (read.kind !== "snapshot") {
      if (read.kind === "unreadable") {
        await logAbortedUpdate(windowId, read.reason);
      }
      return;
    }
    const registry = { ...read.snapshot.registry };
    let changed = false;

    for (const [path, owner] of Object.entries(registry)) {
      if (owner.windowId === windowId) {
        delete registry[path];
        changed = true;
      }
    }

    if (changed) {
      await writeRegistrySnapshot(registry);
    }
  });
}

/** Remove ownership records left by windows that are no longer live. */
export async function pruneOpenFileRegistryWindows(
  liveWindowIds: Iterable<string>,
): Promise<void> {
  const live = new Set(liveWindowIds);
  await withOpenFileRegistryLock(async () => {
    const read = await readRegistrySnapshotForUpdate();
    if (read.kind !== "snapshot") {
      if (read.kind === "unreadable") {
        await logAbortedUpdate("startup", read.reason);
      }
      return;
    }
    const registry: OpenFileRegistry = {};
    let changed = false;
    for (const [path, owner] of Object.entries(read.snapshot.registry)) {
      if (live.has(owner.windowId)) {
        registry[path] = owner;
      } else {
        changed = true;
      }
    }
    if (changed) {
      await writeRegistrySnapshot(registry);
    }
  });
}

export async function renameOpenFileRegistry(
  oldPath: string | null,
  newPath: string,
  windowId: string,
  documentId: string,
): Promise<void> {
  await withOpenFileRegistryLock(async () => {
    const read = await readRegistrySnapshotForUpdate();
    if (read.kind === "unreadable") {
      await logAbortedUpdate(windowId, read.reason);
      return;
    }
    const registry: OpenFileRegistry = {
      ...(read.kind === "snapshot" ? read.snapshot.registry : {}),
    };
    if (oldPath) {
      delete registry[normalizePathSync(oldPath)];
    }
    registry[normalizePathSync(newPath)] = { windowId, documentId };
    await writeRegistrySnapshot(registry);
  });
}

export function resetOpenFileRegistryForTests(): void {
  cachedSnapshot = null;
  registryListenerPromise = null;
}
