import { message } from "@tauri-apps/plugin-dialog";
import type { DocumentState } from "../domain/contracts";
import { appState } from "../state/appState";
import { findWorkspaceByPath } from "../state/appState/contextHelpers";

/**
 * Collect dirty editor documents for one workspace snapshot.
 * Scoped to the workspace matching `workspaceRootPath` only.
 */
export function collectDirtyDocumentsForWorkspace(workspaceRootPath: string): DocumentState[] {
  const snapshot = appState.getSnapshot();
  const workspace = findWorkspaceByPath(snapshot.contexts.workspaces, workspaceRootPath);
  if (!workspace) {
    return [];
  }

  return workspace.snapshot.documents.filter((documentState) => documentState.isDirty);
}

/**
 * Block git mutations that change HEAD or the working tree when the workspace
 * has unsaved editor buffers. Shows a Cancel-only dialog when blocked.
 *
 * @returns `true` when safe to proceed, `false` when blocked.
 */
export async function assertNoUnsavedDocuments(workspaceRootPath: string): Promise<boolean> {
  const dirtyDocuments = collectDirtyDocumentsForWorkspace(workspaceRootPath);
  if (dirtyDocuments.length === 0) {
    return true;
  }

  const count = dirtyDocuments.length;
  const label = count === 1 ? "1 unsaved file" : `${count} unsaved files`;
  await message(
    `${label}. Save or discard your editor changes before continuing.`,
    {
      title: "Unsaved changes",
      kind: "warning",
    },
  );
  return false;
}
