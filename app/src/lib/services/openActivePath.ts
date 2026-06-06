import { isFileMissingError, normalizePathSync, statDiskFingerprint } from "./diskFingerprint";
import { openPath } from "./fileSystem";
import {
  completeLargePendingOpen,
  completeOpenPath,
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
