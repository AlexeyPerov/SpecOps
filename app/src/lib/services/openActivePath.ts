import { isFileMissingError } from "./diskFingerprint";
import { openPath } from "./fileSystem";
import { completeOpenPath, refreshExistingDocumentFromDisk, requestOpenPath } from "./openFileGate";
import { appState } from "../state/appState";
import { syncRecentFiles } from "./recentFilesSync";
import { getErrorMessage } from "../commands/commandErrors";

const MAX_OPEN_BYTES = 10 * 1024 * 1024;

export type OpenActivePathResult =
  | { kind: "opened"; path: string }
  | { kind: "existing"; path: string }
  | { kind: "redirected"; path: string }
  | { kind: "too_large"; path: string }
  | { kind: "missing"; path: string }
  | { kind: "failed"; path: string; reason: string };

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
      const opened = await refreshExistingDocumentFromDisk(gateResult.documentId, path);
      if (opened.sizeBytes > MAX_OPEN_BYTES) {
        return { kind: "too_large", path: opened.path };
      }
      return { kind: "existing", path: gateResult.path };
    }

    const opened = await openPath(path);
    if (opened.sizeBytes > MAX_OPEN_BYTES) {
      return { kind: "too_large", path: opened.path };
    }

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
    case "too_large":
      return "Open failed: file exceeds 10MB MVP limit.";
    case "missing":
      return `Removed missing file from recents: ${result.path}`;
    case "failed":
      return `Failed to open file: ${result.reason}`;
    default:
      return "Open failed.";
  }
}
