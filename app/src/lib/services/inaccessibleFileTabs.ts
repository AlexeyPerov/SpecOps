import { getSessionTabs, isFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import { getActiveSession } from "../state/appState/contextHelpers";
import { logDiagnostic } from "./logging";
import { notifyTabsChangedForSession } from "./sessionManager";

/** Closes the tab for a document that cannot be accessed via the fs plugin scope. */
export function removeInaccessibleDocumentTab(
  documentId: string,
  filePath: string,
  error: unknown,
): void {
  const snapshot = appState.getSnapshot();
  const session = getActiveSession(snapshot);
  const tab = getSessionTabs(session).find(
    (entry) => isFileTab(entry) && entry.documentId === documentId,
  );
  if (!tab) {
    return;
  }
  appState.closeTabsByIds([tab.id], null);
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
