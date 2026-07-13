import { appState } from "../state/appState";
import type { ContextId } from "../domain/contracts";
import { getSessionTabs, isFileTab, normalizeTabState } from "../domain/contracts";
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

/**
 * Find the workspace id whose root matches `workspaceRoot`, regardless of
 * whether it is the active context. Relocation side effects must target the
 * owning workspace even when another workspace (or the notepad) is active.
 */
function findWorkspaceIdByRoot(workspaceRoot: string): ContextId | null {
  const normalizedRoot = normalizePathSync(workspaceRoot);
  const workspace = appState
    .getSnapshot()
    .contexts.workspaces.find(
      (entry) => normalizePathSync(entry.rootPath) === normalizedRoot,
    );
  return workspace?.id ?? null;
}

export async function syncDocumentsAfterPathRelocation(
  workspaceRoot: string,
  oldPath: string,
  newPath: string,
  windowId: string,
): Promise<void> {
  const workspaceId = findWorkspaceIdByRoot(workspaceRoot);
  if (!workspaceId) {
    return;
  }
  const snapshot = appState.getSnapshot();
  const workspace = snapshot.contexts.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace || !isPathUnderRoot(oldPath, workspace.rootPath)) {
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
    // Use context-aware APIs so relocation works while another workspace is active.
    appState.renameDocumentInContext(workspaceId, documentState.id, updatedPath, title);
    await renameOpenFileRegistry(previousPath, updatedPath, windowId, documentState.id);
    try {
      const fingerprint = await statDiskFingerprint(updatedPath);
      appState.setDocumentDiskStateForContext(workspaceId, documentState.id, {
        diskFingerprint: fingerprint,
        fileMissing: false,
      });
    } catch {
      appState.setDocumentDiskStateForContext(workspaceId, documentState.id, {
        diskFingerprint: null,
        fileMissing: true,
      });
    }
  }
}

function documentIdsUnderDeletedPath(
  workspaceRoot: string,
  deletedPath: string,
): { workspaceId: ContextId; ids: Set<string> } | null {
  const normalizedRoot = normalizePathSync(workspaceRoot);
  const workspace = appState
    .getSnapshot()
    .contexts.workspaces.find(
      (entry) => normalizePathSync(entry.rootPath) === normalizedRoot,
    );
  if (!workspace) {
    return null;
  }

  const deletedDocumentIds = new Set<string>();
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
    deletedDocumentIds.add(documentState.id);
  }
  return { workspaceId: workspace.id, ids: deletedDocumentIds };
}

export function markDocumentsMissingUnderPath(workspaceRoot: string, deletedPath: string): void {
  const result = documentIdsUnderDeletedPath(workspaceRoot, deletedPath);
  if (!result) {
    return;
  }
  for (const documentId of result.ids) {
    appState.setDocumentDiskStateForContext(result.workspaceId, documentId, {
      diskFingerprint: null,
      fileMissing: true,
    });
  }
}

export function closeTabsForDeletedDocumentsUnderPath(
  workspaceRoot: string,
  deletedPath: string,
): void {
  const result = documentIdsUnderDeletedPath(workspaceRoot, deletedPath);
  if (!result || result.ids.size === 0) {
    return;
  }
  const { workspaceId, ids: deletedDocumentIds } = result;

  const snapshot = appState.getSnapshot();
  const workspace = snapshot.contexts.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) {
    return;
  }

  const tabIds = getSessionTabs(workspace.snapshot.session)
    .map((rawTab) => normalizeTabState(rawTab))
    .filter((tab) => isFileTab(tab) && deletedDocumentIds.has(tab.documentId))
    .map((tab) => tab.id);

  if (tabIds.length > 0) {
    appState.closeTabsByIds(tabIds, null);
  }
}

export function findFileTabIdForDocument(documentId: string): string | null {
  const snapshot = appState.getSnapshot();
  for (const tab of getSessionTabs(snapshot.contexts.notepad.session)) {
    const normalized = normalizeTabState(tab);
    if (isFileTab(normalized) && normalized.documentId === documentId) {
      return normalized.id;
    }
  }
  for (const workspace of snapshot.contexts.workspaces) {
    for (const tab of getSessionTabs(workspace.snapshot.session)) {
      const normalized = normalizeTabState(tab);
      if (isFileTab(normalized) && normalized.documentId === documentId) {
        return normalized.id;
      }
    }
  }
  return null;
}
