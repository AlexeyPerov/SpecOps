import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
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
  normalizeTabState,
  recomputeSelectedTabId,
} from "../domain/contracts";
import { normalizePathSync } from "./diskFingerprint";
import { ensureSpecOpsDataDir } from "./appDataDir";
import { withSessionWriteLock } from "./sessionWriteLock";

const SESSION_FILE = "session.json";

function emptySession(): AppSessionSnapshot {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    lastActiveWindowId: "main",
    openFileRegistry: {},
    recentFiles: [],
    windows: {},
  };
}

async function getSessionPath(): Promise<string> {
  const dataDir = await ensureSpecOpsDataDir();
  return join(dataDir, SESSION_FILE);
}

async function readSessionSnapshot(): Promise<AppSessionSnapshot | null> {
  try {
    const sessionPath = await getSessionPath();
    const raw = await readTextFile(sessionPath);
    const parsed = JSON.parse(raw) as AppSessionSnapshot;
    if (parsed.version !== 2 || !parsed.windows) {
      return null;
    }
    return {
      ...parsed,
      openFileRegistry: parsed.openFileRegistry ?? {},
      recentFiles: parsed.recentFiles ?? [],
    };
  } catch {
    return null;
  }
}

async function writeSessionSnapshot(snapshot: AppSessionSnapshot): Promise<void> {
  const sessionPath = await getSessionPath();
  await writeTextFile(sessionPath, JSON.stringify(snapshot, null, 2));
}

function buildRegistryForWindow(
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
      const tab = normalizeTabState(rawTab);
      if (!isFileTab(tab)) {
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
  const snapshot = await readSessionSnapshot();
  const current = snapshot ?? emptySession();
  current.openFileRegistry = buildRegistryForWindow(
    snapshot?.openFileRegistry ?? {},
    windowId,
    state,
  );
  current.updatedAt = new Date().toISOString();
  await writeSessionSnapshot(current);
}

export async function readOpenFileRegistry(): Promise<OpenFileRegistry> {
  const snapshot = await readSessionSnapshot();
  return snapshot?.openFileRegistry ?? {};
}

export async function writeOpenFileRegistry(registry: OpenFileRegistry): Promise<void> {
  await withSessionWriteLock(async () => {
    const current = (await readSessionSnapshot()) ?? emptySession();
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
  await withSessionWriteLock(async () => {
    const snapshot = await readSessionSnapshot();
    const registry: OpenFileRegistry = { ...(snapshot?.openFileRegistry ?? {}) };
    registry[normalizePathSync(filePath)] = { windowId, documentId };

    const current = snapshot ?? emptySession();
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
        const tab = normalizeTabState(rawTab);
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
    const session = await readSessionSnapshot();
    const registry = session?.openFileRegistry ?? {};
    const { registry: nextRegistry, snapshot: nextSnapshot } =
      applyRegistryDedupeToWindowSnapshot(registry, windowId, snapshot);

    const current = session ?? emptySession();
    current.openFileRegistry = nextRegistry;
    current.updatedAt = new Date().toISOString();
    await writeSessionSnapshot(current);

    return nextSnapshot;
  });
}

export async function releaseAllOpenFilesForWindow(windowId: string): Promise<void> {
  await withSessionWriteLock(async () => {
    const session = await readSessionSnapshot();
    if (!session) {
      return;
    }
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
    const session = await readSessionSnapshot();
    const registry: OpenFileRegistry = { ...(session?.openFileRegistry ?? {}) };
    if (oldPath) {
      delete registry[normalizePathSync(oldPath)];
    }
    registry[normalizePathSync(newPath)] = { windowId, documentId };

    const current = session ?? emptySession();
    current.openFileRegistry = registry;
    current.updatedAt = new Date().toISOString();
    await writeSessionSnapshot(current);
  });
}
