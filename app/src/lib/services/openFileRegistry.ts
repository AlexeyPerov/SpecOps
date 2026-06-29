import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type {
  AppDomainState,
  AppSessionSnapshot,
  ContextSnapshot,
  OpenFileRegistry,
  WindowSessionSnapshot,
} from "../domain/contracts";
import { isFileTab, normalizeTabState, getSessionTabs, getSessionSelectedTabId, setActivePaneTabs } from "../domain/contracts";
import { normalizePathSync } from "./diskFingerprint";
import { ensureSpecOpsDataDir } from "./appDataDir";

const SESSION_FILE = "session.json";

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

export async function readOpenFileRegistry(): Promise<OpenFileRegistry> {
  const snapshot = await readSessionSnapshot();
  return snapshot?.openFileRegistry ?? {};
}

export async function writeOpenFileRegistry(registry: OpenFileRegistry): Promise<void> {
  const current =
    (await readSessionSnapshot()) ??
    ({
      version: 2,
      updatedAt: new Date().toISOString(),
      lastActiveWindowId: "main",
      openFileRegistry: {},
      recentFiles: [],
      windows: {},
    } satisfies AppSessionSnapshot);

  current.openFileRegistry = registry;
  current.updatedAt = new Date().toISOString();
  await writeSessionSnapshot(current);
}

export async function syncOpenFileRegistryForWindow(
  windowId: string,
  state: AppDomainState,
): Promise<void> {
  const registry = await readOpenFileRegistry();

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
    for (const rawTab of getSessionTabs(contextSnapshot.session)) {
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

  await writeOpenFileRegistry(registry);
}

export async function claimOpenFile(
  filePath: string,
  windowId: string,
  documentId: string,
): Promise<void> {
  const registry = await readOpenFileRegistry();
  registry[normalizePathSync(filePath)] = { windowId, documentId };
  await writeOpenFileRegistry(registry);
}

export function applyRegistryDedupeToWindowSnapshot(
  registry: OpenFileRegistry,
  windowId: string,
  snapshot: WindowSessionSnapshot,
): { registry: OpenFileRegistry; snapshot: WindowSessionSnapshot } {
  const nextRegistry = { ...registry };
  function dedupeContext(context: ContextSnapshot): ContextSnapshot {
    const documentsById = new Map(context.documents.map((doc) => [doc.id, doc]));
    const openTabs = [];

    for (const rawTab of getSessionTabs(context.session)) {
      const tab = normalizeTabState(rawTab);
      if (!isFileTab(tab)) {
        openTabs.push(tab);
        continue;
      }
      const linkedDocument = documentsById.get(tab.documentId);
      if (!linkedDocument?.filePath) {
        openTabs.push(tab);
        continue;
      }

      const key = normalizePathSync(linkedDocument.filePath);
      const owner = nextRegistry[key];
      if (owner && owner.windowId !== windowId) {
        continue;
      }

      nextRegistry[key] = { windowId, documentId: linkedDocument.id };
      openTabs.push(tab);
    }

    const referencedDocIds = new Set(
      openTabs.filter(isFileTab).map((tab) => tab.documentId),
    );
    const documents = context.documents.filter((doc) => referencedDocIds.has(doc.id));
    const previousSelectedId = getSessionSelectedTabId(context.session);
    const selectedTabId = openTabs.some((tab) => tab.id === previousSelectedId)
      ? previousSelectedId
      : openTabs[0]?.id ?? null;

    return {
      documents,
      session: {
        ...context.session,
        editorLayout: setActivePaneTabs(context.session.editorLayout, openTabs, selectedTabId),
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
  const registry = await readOpenFileRegistry();
  const { registry: nextRegistry, snapshot: nextSnapshot } =
    applyRegistryDedupeToWindowSnapshot(registry, windowId, snapshot);

  await writeOpenFileRegistry(nextRegistry);

  return nextSnapshot;
}

export async function releaseAllOpenFilesForWindow(windowId: string): Promise<void> {
  const registry = await readOpenFileRegistry();
  let changed = false;

  for (const [path, owner] of Object.entries(registry)) {
    if (owner.windowId === windowId) {
      delete registry[path];
      changed = true;
    }
  }

  if (changed) {
    await writeOpenFileRegistry(registry);
  }
}

export async function renameOpenFileRegistry(
  oldPath: string | null,
  newPath: string,
  windowId: string,
  documentId: string,
): Promise<void> {
  const registry = await readOpenFileRegistry();
  if (oldPath) {
    delete registry[normalizePathSync(oldPath)];
  }
  registry[normalizePathSync(newPath)] = { windowId, documentId };
  await writeOpenFileRegistry(registry);
}
