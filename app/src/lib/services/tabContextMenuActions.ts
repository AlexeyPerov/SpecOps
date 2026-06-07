import type { DocumentState, TabState } from "../domain/contracts";
import { isFileTab } from "../domain/contracts";
import { workspaceRelativePath } from "./workspacePaths";

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
