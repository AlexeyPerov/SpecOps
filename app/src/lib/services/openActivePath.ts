import {
  allTabs,
  findTabOwner,
  isFileTab,
} from "../domain/contracts";
import { isFileMissingError, normalizePathSync, statDiskFingerprint } from "./diskFingerprint";
import { openPath } from "./fileSystem";
import {
  completeLargePendingOpen,
  completeOpenPath,
  completeOpenPathInPane,
  openedFileEncoding,
  requestOpenPath,
} from "./openFileGate";
import { shouldGateFileOpenBySize } from "./largeFileOpen";
import { appState } from "../state/appState";
import { syncRecentFiles } from "./recentFilesSync";
import { getErrorMessage } from "../commands/commandErrors";
import { releasePendingOpenFile } from "./openFileRegistry";
import { checkDocumentIfDeferred } from "./externalFileChanges";
import { logDiagnostic } from "./logging";

export type OpenActivePathResult =
  | { kind: "opened"; path: string }
  | { kind: "existing"; path: string }
  | { kind: "redirected"; path: string }
  | { kind: "pending_confirm"; path: string }
  | { kind: "missing"; path: string }
  | { kind: "failed"; path: string; reason: string };

function getMaxOpenWithoutConfirmBytes(): number {
  return appState.getSnapshot().settings.externalFiles.maxOpenWithoutConfirmBytes;
}

async function pruneMissingRecentFile(path: string): Promise<void> {
  const snapshot = appState.getSnapshot();
  const recentFiles = snapshot.recentFiles.filter((entry) => entry !== path);
  if (recentFiles.length === snapshot.recentFiles.length) {
    return;
  }
  appState.replaceRecentFiles(recentFiles);
  syncRecentFiles(recentFiles);
}

/**
 * Check an already-visible document without making file activation wait for
 * filesystem I/O. The external-change engine performs a metadata-only check
 * first and reads contents only when the fingerprint changed.
 */
function scheduleExistingDocumentCheck(documentId: string, path: string): void {
  queueMicrotask(() => {
    void checkDocumentIfDeferred(documentId, "tab").catch((error: unknown) => {
      void logDiagnostic({
        level: "warn",
        source: "frontend",
        timestamp: new Date().toISOString(),
        message: "background external-file check failed after file activation",
        metadata: { documentId, path, error: getErrorMessage(error) },
      }).catch(() => {
        // File activation already succeeded; diagnostics must stay best-effort.
      });
    });
  });
}

/** Move an existing file tab to a drop target without replacing its buffer. */
function moveExistingDocumentToPane(documentId: string, paneId: string): void {
  const layout = appState.getActiveSession().editorLayout;
  const tab = allTabs(layout).find(
    (entry) => isFileTab(entry) && entry.documentId === documentId,
  );
  const owner = tab ? findTabOwner(layout, tab.id) : null;
  const target = layout.panes.find((pane) => pane.id === paneId);
  if (!tab || !owner || !target || owner.pane.id === paneId) {
    return;
  }
  appState.moveTabBetweenPanes(owner.pane.id, tab.id, paneId, target.tabs.length);
}

export async function openActivePath(
  path: string,
  windowId: string,
): Promise<OpenActivePathResult> {
  try {
    const gateResult = await requestOpenPath(path, windowId);
    if (gateResult.kind === "redirected") {
      appState.touchRecentFile(gateResult.path);
      return { kind: "redirected", path: gateResult.path };
    }
    if (gateResult.kind === "existing") {
      scheduleExistingDocumentCheck(gateResult.documentId, path);
      return { kind: "existing", path: gateResult.path };
    }

    const maxOpenWithoutConfirmBytes = getMaxOpenWithoutConfirmBytes();
    const fingerprint = await statDiskFingerprint(path);
    if (shouldGateFileOpenBySize(path, fingerprint.sizeBytes, maxOpenWithoutConfirmBytes)) {
      await completeLargePendingOpen(path, fingerprint, windowId);
      return { kind: "pending_confirm", path: normalizePathSync(path) };
    }

    const opened = await openPath(path);
    await completeOpenPath(
      opened.path,
      opened.content,
      windowId,
      opened.contentKind,
      openedFileEncoding(opened),
      opened.fingerprint,
    );
    return { kind: "opened", path: opened.path };
  } catch (error: unknown) {
    await releasePendingOpenFile(path, windowId);
    if (isFileMissingError(error)) {
      await pruneMissingRecentFile(path);
      return { kind: "missing", path };
    }
    const reason = getErrorMessage(error);
    return { kind: "failed", path, reason };
  }
}

/**
 * Phase 6 — open a file into a specific pane (file→pane DnD). Same gating as
 * {@link openActivePath} (cross-window redirect, large-file confirm), but the
 * terminal "open" step routes through {@link completeOpenPathInPane} so the
 * file lands in `paneId` (stealing it from any other pane first per Q9). An
 * existing document is moved/focused immediately without replacing its buffer;
 * external-change detection runs afterward in the background.
 */
export async function openActivePathInPane(
  path: string,
  windowId: string,
  paneId: string,
): Promise<OpenActivePathResult> {
  try {
    const gateResult = await requestOpenPath(path, windowId);
    if (gateResult.kind === "redirected") {
      appState.touchRecentFile(gateResult.path);
      return { kind: "redirected", path: gateResult.path };
    }
    if (gateResult.kind === "existing") {
      moveExistingDocumentToPane(gateResult.documentId, paneId);
      scheduleExistingDocumentCheck(gateResult.documentId, path);
      return { kind: "existing", path: gateResult.path };
    }

    const maxOpenWithoutConfirmBytes = getMaxOpenWithoutConfirmBytes();
    const fingerprint = await statDiskFingerprint(path);
    if (shouldGateFileOpenBySize(path, fingerprint.sizeBytes, maxOpenWithoutConfirmBytes)) {
      await completeLargePendingOpen(path, fingerprint, windowId);
      return { kind: "pending_confirm", path: normalizePathSync(path) };
    }

    const opened = await openPath(path);
    await completeOpenPathInPane(
      opened.path,
      opened.content,
      windowId,
      paneId,
      opened.contentKind,
      openedFileEncoding(opened),
      opened.fingerprint,
    );
    return { kind: "opened", path: opened.path };
  } catch (error: unknown) {
    await releasePendingOpenFile(path, windowId);
    if (isFileMissingError(error)) {
      await pruneMissingRecentFile(path);
      return { kind: "missing", path };
    }
    const reason = getErrorMessage(error);
    return { kind: "failed", path, reason };
  }
}

export function describeOpenActivePathResult(result: OpenActivePathResult): string {
  switch (result.kind) {
    case "opened":
      return `Opened ${result.path}`;
    case "existing":
      return `Opened ${result.path}`;
    case "redirected":
      return `Switched to ${result.path} in another window.`;
    case "pending_confirm":
      return `Opened ${result.path} (confirm to load contents)`;
    case "missing":
      return `Removed missing file from recents: ${result.path}`;
    case "failed":
      return `Failed to open file: ${result.reason}`;
    default:
      return "Open failed.";
  }
}

/** Paths that landed in this window (new, existing, or pending large-file confirm). */
export function isSuccessfulOpenActivePathResult(result: OpenActivePathResult): boolean {
  return (
    result.kind === "opened" ||
    result.kind === "existing" ||
    result.kind === "pending_confirm"
  );
}
