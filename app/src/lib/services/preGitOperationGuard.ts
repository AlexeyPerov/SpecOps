import { appState } from "../state/appState";
import { findWorkspaceByPath } from "../state/appState/contextHelpers";
import type { SaveDocumentDeps } from "./documentSave";
import { autosaveWorkspaceDirtyDocuments } from "./preGitAutosave";
import { promptPreGitAutosaveFailures } from "./preGitAutosavePrompt";
import { assertNoUnsavedDocuments } from "./unsavedDocumentGuard";

export interface PreGitOperationGuardOptions {
  /** When false, skips autosave and uses the legacy unsaved-document guard. */
  enabled?: boolean;
  deps: SaveDocumentDeps | null;
}

/**
 * Attempt autosave for dirty editor buffers, then decide whether a git mutation
 * may proceed. Falls back to {@link assertNoUnsavedDocuments} when autosave is
 * disabled or the prompt runner is unavailable.
 */
export async function prepareWorkspaceForGitOperation(
  workspaceRootPath: string,
  options: PreGitOperationGuardOptions,
): Promise<boolean> {
  if (options.enabled === false || !options.deps) {
    return assertNoUnsavedDocuments(workspaceRootPath);
  }

  const snapshot = appState.getSnapshot();
  const workspace = findWorkspaceByPath(snapshot.contexts.workspaces, workspaceRootPath);
  if (!workspace) {
    return assertNoUnsavedDocuments(workspaceRootPath);
  }

  const result = await autosaveWorkspaceDirtyDocuments(workspace.id, {
    enabled: true,
    deps: options.deps,
  });

  if (result.failures.length > 0) {
    const choice = await promptPreGitAutosaveFailures({ failures: result.failures });
    if (!choice) {
      return assertNoUnsavedDocuments(workspaceRootPath);
    }
    if (choice.type === "cancel") {
      return false;
    }
    return true;
  }

  return assertNoUnsavedDocuments(workspaceRootPath);
}
