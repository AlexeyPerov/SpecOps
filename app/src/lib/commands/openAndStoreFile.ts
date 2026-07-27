import {
  completeLargePendingOpen,
  completeOpenPath,
  openedFileEncoding,
  requestOpenPath,
} from "../services/openFileGate";
import type { OpenedFile } from "../services/fileSystem";
import { initializeDocumentDiskState } from "../services/externalFileChanges";
import { shouldGateFileOpenBySize } from "../services/largeFileOpen";
import { appState } from "../state/appState";

export async function openAndStoreFile(
  notify: (message: string) => void,
  windowId: string,
  opened: OpenedFile | null,
): Promise<void> {
  if (!opened) {
    return;
  }

  const gateResult = await requestOpenPath(opened.path, windowId);
  if (gateResult.kind === "redirected") {
    notify(`Switched to ${opened.path} in another window.`);
    return;
  }

  const maxOpenWithoutConfirmBytes =
    appState.getSnapshot().settings.externalFiles.maxOpenWithoutConfirmBytes;
  const needsConfirm = shouldGateFileOpenBySize(
    opened.path,
    opened.sizeBytes,
    maxOpenWithoutConfirmBytes,
  );

  if (gateResult.kind === "existing") {
    if (needsConfirm) {
      appState.upgradeDocumentFromOpenedFile(gateResult.documentId, opened.path, "", "large_pending");
      appState.setDocumentDiskState(gateResult.documentId, {
        diskFingerprint: opened.fingerprint,
        fileMissing: false,
      });
      notify(`Opened ${opened.path} (confirm to load contents)`);
      return;
    }
    appState.upgradeDocumentFromOpenedFile(
      gateResult.documentId,
      opened.path,
      opened.content,
      opened.contentKind,
      openedFileEncoding(opened),
    );
    await initializeDocumentDiskState(gateResult.documentId, opened.path, opened.fingerprint);
    notify(`Opened ${opened.path}`);
    return;
  }

  if (needsConfirm) {
    await completeLargePendingOpen(opened.path, opened.fingerprint, windowId);
    notify(`Opened ${opened.path} (confirm to load contents)`);
    return;
  }

  await completeOpenPath(
    opened.path,
    opened.content,
    windowId,
    opened.contentKind,
    openedFileEncoding(opened),
    opened.fingerprint,
  );
  notify(`Opened ${opened.path}`);
}
