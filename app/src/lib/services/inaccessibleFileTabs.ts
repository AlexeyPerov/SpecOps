import { allTabs, isFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import { allContextSnapshots } from "../state/appState/contextHelpers";
import { logDiagnostic } from "./logging";
import { notifyTabsChangedForSession } from "./sessionManager";

/**
 * Closes the tab for a document that cannot be accessed via the fs plugin
 * scope. Searches every context (notepad + chat-http + all workspaces) for the
 * document id, because the inaccessible file may belong to a workspace that is
 * not the active context.
 */
export function removeInaccessibleDocumentTab(
  documentId: string,
  filePath: string,
  error: unknown,
): void {
  const snapshot = appState.getSnapshot();
  let removedTabId: string | null = null;
  for (const entry of allContextSnapshots(snapshot)) {
    const tab = allTabs(entry.snapshot.session.editorLayout).find(
      (t) => isFileTab(t) && t.documentId === documentId,
    );
    if (tab) {
      removedTabId = tab.id;
      break;
    }
  }
  if (!removedTabId) {
    return;
  }
  appState.closeTabsByIds([removedTabId], null);
  notifyTabsChangedForSession(appState.getSnapshot());
  const message = error instanceof Error ? error.message : String(error);
  void logDiagnostic({
    level: "warn",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "removed inaccessible file tab",
    metadata: {
      documentId,
      filePath,
      reason: message,
    },
  });
}
