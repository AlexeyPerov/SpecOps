import { appState } from "../state/appState";
import { isFileTab, normalizeTabState } from "../domain/contracts";
import { normalizePathSync, statDiskFingerprint } from "./diskFingerprint";
import { renameOpenFileRegistry } from "./openFileRegistry";
import { isPathUnderRoot } from "./workspacePaths";

function isPathEqualOrUnder(prefix: string, path: string): boolean {
  const normalizedPrefix = normalizePathSync(prefix).replace(/\/+$/, "");
  const normalizedPath = normalizePathSync(path).replace(/\/+$/, "");
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

function relocatedPath(oldPrefix: string, newPrefix: string, filePath: string): string {
  const normalizedOld = normalizePathSync(oldPrefix).replace(/\/+$/, "");
  const normalizedNew = normalizePathSync(newPrefix).replace(/\/+$/, "");
  const normalizedFile = normalizePathSync(filePath);
  if (normalizedFile === normalizedOld) {
    return normalizedNew;
  }
  return `${normalizedNew}${normalizedFile.slice(normalizedOld.length)}`;
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export async function syncDocumentsAfterPathRelocation(
  workspaceRoot: string,
  oldPath: string,
  newPath: string,
  windowId: string,
): Promise<void> {
  const snapshot = appState.getSnapshot();
  const activeId = snapshot.contexts.activeContextId;
  if (activeId === "notepad") {
    return;
  }
  const workspace = snapshot.contexts.workspaces.find((entry) => entry.id === activeId);
  if (!workspace || !isPathUnderRoot(oldPath, workspace.rootPath)) {
    return;
  }
  if (normalizePathSync(workspace.rootPath) !== normalizePathSync(workspaceRoot)) {
    return;
  }

  for (const documentState of workspace.snapshot.documents) {
    if (!documentState.filePath) {
      continue;
    }
    if (!isPathEqualOrUnder(oldPath, documentState.filePath)) {
      continue;
    }
    const updatedPath = relocatedPath(oldPath, newPath, documentState.filePath);
    const title = basename(updatedPath);
    const previousPath = documentState.filePath;
    appState.renameDocument(documentState.id, updatedPath, title);
    await renameOpenFileRegistry(previousPath, updatedPath, windowId, documentState.id);
    try {
      const fingerprint = await statDiskFingerprint(updatedPath);
      appState.setDocumentDiskState(documentState.id, {
        diskFingerprint: fingerprint,
        fileMissing: false,
      });
    } catch {
      appState.setDocumentDiskState(documentState.id, {
        diskFingerprint: null,
        fileMissing: true,
      });
    }
  }
}

export function markDocumentsMissingUnderPath(workspaceRoot: string, deletedPath: string): void {
  const snapshot = appState.getSnapshot();
  const activeId = snapshot.contexts.activeContextId;
  if (activeId === "notepad") {
    return;
  }
  const workspace = snapshot.contexts.workspaces.find((entry) => entry.id === activeId);
  if (!workspace) {
    return;
  }

  for (const documentState of workspace.snapshot.documents) {
    if (!documentState.filePath) {
      continue;
    }
    if (!isPathUnderRoot(documentState.filePath, workspaceRoot)) {
      continue;
    }
    if (!isPathEqualOrUnder(deletedPath, documentState.filePath)) {
      continue;
    }
    appState.setDocumentDiskState(documentState.id, {
      diskFingerprint: null,
      fileMissing: true,
    });
  }
}

export function findFileTabIdForDocument(documentId: string): string | null {
  const snapshot = appState.getSnapshot();
  for (const tab of snapshot.contexts.notepad.session.openTabs) {
    const normalized = normalizeTabState(tab);
    if (isFileTab(normalized) && normalized.documentId === documentId) {
      return normalized.id;
    }
  }
  for (const workspace of snapshot.contexts.workspaces) {
    for (const tab of workspace.snapshot.session.openTabs) {
      const normalized = normalizeTabState(tab);
      if (isFileTab(normalized) && normalized.documentId === documentId) {
        return normalized.id;
      }
    }
  }
  return null;
}
