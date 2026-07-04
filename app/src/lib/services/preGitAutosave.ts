import type { ContextId, DocumentState } from "../domain/contracts";
import { appState } from "../state/appState";
import { getContextSnapshotById } from "../state/appState/contextHelpers";
import { isEditableContentKind } from "./fileContentKind";
import { saveDocumentKeepingTab, type SaveDocumentDeps } from "./documentSave";

export interface PreGitAutosaveOptions {
  /** When false, returns an empty result without saving (future settings toggle). */
  enabled?: boolean;
  deps: SaveDocumentDeps;
}

export interface PreGitAutosaveSkippedDocument {
  documentId: string;
  title: string;
  reason: "not-editable" | "already-clean";
}

export interface PreGitAutosaveFailure {
  documentId: string;
  title: string;
  filePath: string | null;
  message: string;
}

export interface PreGitAutosaveResult {
  savedCount: number;
  skipped: PreGitAutosaveSkippedDocument[];
  failures: PreGitAutosaveFailure[];
}

function sortDirtyDocuments(documents: DocumentState[]): DocumentState[] {
  return documents
    .filter((document) => document.isDirty)
    .sort((left, right) => {
      const leftKey = left.filePath ?? left.title;
      const rightKey = right.filePath ?? right.title;
      return leftKey.localeCompare(rightKey, undefined, { sensitivity: "base" });
    });
}

function emptyResult(): PreGitAutosaveResult {
  return { savedCount: 0, skipped: [], failures: [] };
}

/**
 * Attempt to save all dirty editor buffers for one workspace before a git operation.
 * Uses the existing document save path; never throws on individual save failures.
 */
export async function autosaveWorkspaceDirtyDocuments(
  workspaceId: ContextId,
  options: PreGitAutosaveOptions,
): Promise<PreGitAutosaveResult> {
  if (options.enabled === false) {
    return emptyResult();
  }

  const snapshot = getContextSnapshotById(appState.getSnapshot(), workspaceId);
  if (!snapshot) {
    return emptyResult();
  }

  const dirtyDocuments = sortDirtyDocuments(snapshot.documents);
  if (dirtyDocuments.length === 0) {
    return emptyResult();
  }

  const result: PreGitAutosaveResult = {
    savedCount: 0,
    skipped: [],
    failures: [],
  };

  for (const document of dirtyDocuments) {
    if (!isEditableContentKind(document.contentKind)) {
      result.skipped.push({
        documentId: document.id,
        title: document.title,
        reason: "not-editable",
      });
      continue;
    }

    try {
      const saved = await saveDocumentKeepingTab(document, options.deps);
      if (saved) {
        result.savedCount += 1;
      } else {
        result.failures.push({
          documentId: document.id,
          title: document.title,
          filePath: document.filePath,
          message: document.filePath
            ? `Could not save "${document.title}".`
            : `Save cancelled for untitled document "${document.title}".`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failures.push({
        documentId: document.id,
        title: document.title,
        filePath: document.filePath,
        message: message || `Could not save "${document.title}".`,
      });
    }
  }

  return result;
}
