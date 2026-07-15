import { isFileMissingError, normalizePathSync, statDiskFingerprint } from "./diskFingerprint";
import { openPath } from "./fileSystem";
import {
  completeLargePendingOpen,
  completeOpenPath,
  completeOpenPathInPane,
  refreshExistingDocumentFromDisk,
  requestOpenPath,
} from "./openFileGate";
import { shouldGateFileOpenBySize } from "./largeFileOpen";
import { appState } from "../state/appState";
import { syncRecentFiles } from "./recentFilesSync";
import { getErrorMessage } from "../commands/commandErrors";

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
      const existingDocument = appState
        .getActiveDocuments()
        .find((documentState) => documentState.id === gateResult.documentId);
      if (existingDocument?.contentKind === "large_pending") {
        return { kind: "existing", path: gateResult.path };
      }
      await refreshExistingDocumentFromDisk(gateResult.documentId, path);
      return { kind: "existing", path: gateResult.path };
    }

    const maxOpenWithoutConfirmBytes = getMaxOpenWithoutConfirmBytes();
    const fingerprint = await statDiskFingerprint(path);
    if (shouldGateFileOpenBySize(path, fingerprint.sizeBytes, maxOpenWithoutConfirmBytes)) {
      await completeLargePendingOpen(path, fingerprint, windowId);
      return { kind: "pending_confirm", path: normalizePathSync(path) };
    }

    const opened = await openPath(path);
    await completeOpenPath(opened.path, opened.content, windowId, opened.contentKind);
    return { kind: "opened", path: opened.path };
  } catch (error: unknown) {
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
 * file lands in `paneId` (stealing it from any other pane first per Q9). The
 * "existing" branch also re-reads from disk for consistency with the active-pane
 * open path, then opens into the target pane via the reducer's steal/focus path.
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
      const existingDocument = appState
        .getActiveDocuments()
        .find((documentState) => documentState.id === gateResult.documentId);
      if (existingDocument?.contentKind === "large_pending") {
        return { kind: "existing", path: gateResult.path };
      }
      await refreshExistingDocumentFromDisk(gateResult.documentId, path);
      // Re-open into the target pane; openFileInPane steals + focuses.
      const reOpened = await openPath(path);
      await completeOpenPathInPane(reOpened.path, reOpened.content, windowId, paneId, reOpened.contentKind);
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
    );
    return { kind: "opened", path: opened.path };
  } catch (error: unknown) {
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
