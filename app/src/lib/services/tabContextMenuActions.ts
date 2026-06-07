import type { DocumentState, TabState } from "../domain/contracts";
import { isFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import { revealInFileManager } from "./revealInFileManager";
import { readNearbyTextFiles, type NearbyTextFile } from "./nearbyFiles";
import { describeOpenActivePathResult, openActivePath } from "./openActivePath";
import { runInNotepadContext, workspaceRelativePath } from "./workspacePaths";
import { renameDocumentOnDisk } from "./documentRename";
import {
  closeOtherTabsWithUnsavedPrompt,
  closeTabWithUnsavedPrompt,
  closeTabsToRightWithUnsavedPrompt,
  type CloseTabFlowDeps,
} from "./closeTabFlow";

export function tabDocumentForTab(
  tab: TabState,
  documents: DocumentState[],
): DocumentState | undefined {
  if (!isFileTab(tab)) {
    return undefined;
  }
  return documents.find((doc) => doc.id === tab.documentId);
}

export function collectTabOpenPaths(
  openTabs: TabState[],
  documents: DocumentState[],
): string[] {
  const openPaths = new Set<string>();
  for (const tab of openTabs) {
    const doc = tabDocumentForTab(tab, documents);
    if (doc?.filePath) {
      openPaths.add(doc.filePath);
    }
  }
  return [...openPaths];
}

export function canRevealTabInFileManager(
  tab: TabState | null,
  documents: DocumentState[],
): boolean {
  return Boolean(tab && tabDocumentForTab(tab, documents)?.filePath);
}

export function canCloseOtherTabs(
  openTabs: TabState[],
  contextTab: TabState | null,
): boolean {
  return Boolean(
    contextTab && openTabs.some((tab) => tab.id !== contextTab.id && !tab.pinned),
  );
}

export function canCloseTabsToRight(
  openTabs: TabState[],
  contextTab: TabState | null,
): boolean {
  if (!contextTab) {
    return false;
  }
  const contextIndex = openTabs.findIndex((tab) => tab.id === contextTab.id);
  return (
    contextIndex >= 0 &&
    openTabs.slice(contextIndex + 1).some((tab) => !tab.pinned)
  );
}

export function canCloseMissingFileTabs(
  openTabs: TabState[],
  documents: DocumentState[],
): boolean {
  return openTabs.some((tab) => {
    if (tab.pinned) {
      return false;
    }
    return Boolean(tabDocumentForTab(tab, documents)?.fileMissing);
  });
}

export function canOpenNearbyFiles(tabDoc: DocumentState | null): boolean {
  return Boolean(tabDoc?.filePath);
}

export function canCopyTabPath(tabDoc: DocumentState | null): boolean {
  return Boolean(tabDoc?.filePath);
}

export function canCopyRelativePath(
  filePath: string | null | undefined,
  workspaceRoot: string | null,
): boolean {
  if (!filePath || !workspaceRoot) {
    return false;
  }
  return workspaceRelativePath(filePath, workspaceRoot) !== null;
}

export function canRenameTab(
  tab: TabState | null,
  tabDoc: DocumentState | null,
): boolean {
  return Boolean(
    tab && isFileTab(tab) && tabDoc?.filePath && !tabDoc.fileMissing,
  );
}

export type TabContextMenuHandlerDeps = {
  getContextTab: () => TabState | null;
  getOpenTabs: () => TabState[];
  getDocuments: () => DocumentState[];
  getWindowId: () => string;
  notify: (message: string) => void;
  closeContextMenu: () => void;
  getNearbyFiles: () => NearbyTextFile[];
};

export function createTabContextMenuHandlers(deps: TabContextMenuHandlerDeps) {
  const closeTabDeps: CloseTabFlowDeps = {
    getWindowId: deps.getWindowId,
    notify: deps.notify,
  };

  function tabDocument(tab: TabState): DocumentState | undefined {
    return tabDocumentForTab(tab, deps.getDocuments());
  }

  async function renameContextTab(): Promise<void> {
    const contextTab = deps.getContextTab();
    const tabDoc = contextTab ? tabDocument(contextTab) : undefined;
    if (!tabDoc?.filePath) {
      deps.closeContextMenu();
      return;
    }
    try {
      await renameDocumentOnDisk(tabDoc.id, {
        windowId: deps.getWindowId(),
        notify: deps.notify,
      });
    } finally {
      deps.closeContextMenu();
    }
  }

  async function revealTabInFileManager(tab: TabState): Promise<void> {
    const tabDoc = tabDocument(tab);
    if (!tabDoc?.filePath) {
      deps.closeContextMenu();
      return;
    }
    try {
      await revealInFileManager(tabDoc.filePath);
    } catch {
      // reveal is best-effort from the tab menu
    }
    deps.closeContextMenu();
  }

  async function copyTabPath(tab: TabState): Promise<void> {
    const tabDoc = tabDocument(tab);
    if (!tabDoc?.filePath) {
      deps.closeContextMenu();
      return;
    }
    try {
      await navigator.clipboard.writeText(tabDoc.filePath);
    } catch {
      // clipboard is best-effort from the tab menu
    }
    deps.closeContextMenu();
  }

  async function copyTabRelativePath(tab: TabState): Promise<void> {
    const tabDoc = tabDocument(tab);
    const workspaceRoot = appState.getWorkspaceRoot();
    if (!tabDoc?.filePath || !workspaceRoot) {
      deps.closeContextMenu();
      return;
    }
    const relativePath = workspaceRelativePath(tabDoc.filePath, workspaceRoot);
    if (relativePath === null) {
      deps.closeContextMenu();
      return;
    }
    try {
      await navigator.clipboard.writeText(relativePath);
    } catch {
      // clipboard is best-effort from the tab menu
    }
    deps.closeContextMenu();
  }

  async function openPathWithPipeline(path: string): Promise<void> {
    try {
      const result = await openActivePath(path, deps.getWindowId());
      if (result.kind === "failed") {
        deps.notify(describeOpenActivePathResult(result));
      }
    } catch {
      // nearby open is best-effort from the tab menu
    }
  }

  async function openNearbyFile(path: string): Promise<void> {
    await openPathWithPipeline(path);
    deps.closeContextMenu();
  }

  async function openAllNearbyFiles(): Promise<void> {
    await runInNotepadContext(async () => {
      for (const nearbyFile of deps.getNearbyFiles()) {
        await openPathWithPipeline(nearbyFile.path);
      }
    });
    deps.closeContextMenu();
  }

  async function closeContextTabWithPrompt(): Promise<void> {
    const contextTab = deps.getContextTab();
    if (!contextTab) {
      return;
    }
    await closeTabWithUnsavedPrompt(contextTab.id, closeTabDeps);
    deps.closeContextMenu();
  }

  async function closeOtherTabsWithPrompt(): Promise<void> {
    const contextTab = deps.getContextTab();
    if (!contextTab) {
      return;
    }
    await closeOtherTabsWithUnsavedPrompt(contextTab.id, closeTabDeps);
    deps.closeContextMenu();
  }

  async function closeTabsToRightWithPrompt(): Promise<void> {
    const contextTab = deps.getContextTab();
    if (!contextTab) {
      return;
    }
    await closeTabsToRightWithUnsavedPrompt(contextTab.id, closeTabDeps);
    deps.closeContextMenu();
  }

  function closeMissingFileTabs(): void {
    appState.closeMissingFileTabs();
    deps.closeContextMenu();
  }

  return {
    renameContextTab,
    revealTabInFileManager,
    copyTabPath,
    copyTabRelativePath,
    openNearbyFile,
    openAllNearbyFiles,
    closeContextTabWithPrompt,
    closeOtherTabsWithPrompt,
    closeTabsToRightWithPrompt,
    closeMissingFileTabs,
  };
}

export async function prefetchNearbyFilesForTab(
  tab: TabState,
  documents: DocumentState[],
  openTabs: TabState[],
  requestId: number,
): Promise<{ files: NearbyTextFile[]; requestId: number } | null> {
  const tabDoc = tabDocumentForTab(tab, documents);
  if (!tabDoc?.filePath) {
    return { files: [], requestId };
  }
  try {
    const files = await readNearbyTextFiles(
      tabDoc.filePath,
      collectTabOpenPaths(openTabs, documents),
      10,
    );
    return { files, requestId };
  } catch {
    return { files: [], requestId };
  }
}
