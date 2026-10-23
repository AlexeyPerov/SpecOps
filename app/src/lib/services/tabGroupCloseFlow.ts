import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ContextId } from "../domain/contracts";
import { DEFAULT_TAB_GROUP_ID, findTabGroup } from "../domain/contracts";
import { appState } from "../state/appState";
import { requestConfirm } from "./confirmDialogUi";
import { clearDocumentExternalChangeState } from "./externalFileChanges";
import { syncOpenFileRegistryForWindow } from "./openFileRegistry";
import { saveAllDirtyDocumentsToDisk } from "./workspaceCloseFlow";

function currentWindowId(): string {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? getCurrentWebviewWindow().label : "main";
}

/**
 * Delete a tab group after Save/Discard/Cancel for its unsaved buffers. The
 * default group is never deleted. Files on disk are untouched; their tabs
 * close with the group and the window releases their open-file claims.
 */
export async function removeTabGroupWithConfirm(
  groupId: ContextId,
  notify: (message: string) => void,
  deps: { getWindowId: () => string } = { getWindowId: currentWindowId },
): Promise<boolean> {
  if (groupId === DEFAULT_TAB_GROUP_ID) {
    notify("The default tab group cannot be deleted.");
    return false;
  }
  const group = findTabGroup(appState.getSnapshot().contexts.tabGroups, groupId);
  if (!group) {
    return false;
  }
  try {
    const dirtyDocuments = appState.getTabGroupDirtyDocuments(groupId);
    if (dirtyDocuments.length) {
      const shouldSave = await requestConfirm({
        title: "Unsaved changes",
        message: `"${group.name}" has ${dirtyDocuments.length} unsaved file(s). Save changes before deleting the group?`,
        confirmLabel: "Save all",
        cancelLabel: "More options",
      });
      if (shouldSave) {
        if (!(await saveAllDirtyDocumentsToDisk(groupId, dirtyDocuments, notify, deps))) return false;
      } else {
        const discard = await requestConfirm({
          title: "Discard changes",
          message: `Discard all unsaved changes and delete "${group.name}"?`,
          confirmLabel: "Discard & delete",
          cancelLabel: "Cancel",
          danger: true,
        });
        if (!discard) return false;
      }
    }
    if (appState.getTabGroupDirtyDocuments(groupId).some((doc) => !dirtyDocuments.some((before) => before.id === doc.id && before.content === doc.content))) {
      notify("Tab group changed while confirming. Review the changes and delete it again.");
      return false;
    }
    const documents = findTabGroup(appState.getSnapshot().contexts.tabGroups, groupId)?.snapshot.documents ?? [];
    if (!appState.removeTabGroup(groupId)) return false;
    for (const document of documents) clearDocumentExternalChangeState(document.id, document.filePath);
    await syncOpenFileRegistryForWindow(deps.getWindowId(), appState.getSnapshot()).catch(() => {});
    return true;
  } catch (error) {
    notify(String(error));
    return false;
  }
}
