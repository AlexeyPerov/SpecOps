import type { ContextId, DocumentState } from "../domain/contracts";
import { allTabs, isFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import { allContextSnapshots } from "../state/appState/contextHelpers";
import { logDiagnostic } from "./logging";
import { notifyTabsChangedForSession } from "./sessionManager";

/**
 * Handles a document that cannot be accessed via the fs plugin scope. Searches
 * every context (notepad + chat-http + all workspaces) for the document id,
 * because the inaccessible file may belong to a workspace that is not the
 * active context.
 *
 * Clean documents lose no data, so their tab is closed. Dirty documents are
 * NEVER force-closed — a background stat failure (scope error, dotfile) must
 * not discard unsaved edits. Instead the document is marked `fileMissing` so
 * the UI surfaces it and the user can Save As; the flag also makes this
 * function idempotent, so retrying callers don't spam state writes or logs.
 */
export function removeInaccessibleDocumentTab(
  documentId: string,
  filePath: string,
  error: unknown,
): void {
  const snapshot = appState.getSnapshot();
  let tabId: string | null = null;
  let ownerContextId: ContextId | null = null;
  let documentState: DocumentState | null = null;
  for (const entry of allContextSnapshots(snapshot)) {
    const tab = allTabs(entry.snapshot.session.editorLayout).find(
      (t) => isFileTab(t) && t.documentId === documentId,
    );
    if (tab) {
      tabId = tab.id;
      ownerContextId = entry.id;
      documentState =
        entry.snapshot.documents.find((doc) => doc.id === documentId) ?? null;
      break;
    }
  }
  if (!tabId || !ownerContextId) {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);

  if (documentState?.isDirty) {
    // Keep the tab and its unsaved buffer. Marking the document missing (once)
    // lets the user notice and Save As; repeated checks become no-ops.
    if (documentState.fileMissing) {
      return;
    }
    appState.setDocumentDiskStateForContext(ownerContextId, documentId, {
      diskFingerprint: documentState.diskFingerprint,
      fileMissing: true,
    });
    void logDiagnostic({
      level: "warn",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "inaccessible file has unsaved edits; kept tab open",
      metadata: {
        documentId,
        filePath,
        reason: message,
      },
    });
    return;
  }

  // Must target the owning context: closing against the active context is a
  // no-op when the tab lives elsewhere, and callers retry on every check.
  appState.closeTabsByIdsInContext(ownerContextId, [tabId], null);
  notifyTabsChangedForSession(appState.getSnapshot());
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
