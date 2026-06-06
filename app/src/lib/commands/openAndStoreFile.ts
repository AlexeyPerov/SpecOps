import {
  completeLargePendingOpen,
  completeOpenPath,
  requestOpenPath,
} from "../services/openFileGate";
import { initializeDocumentDiskState } from "../services/externalFileChanges";
import { statDiskFingerprint } from "../services/diskFingerprint";
import { shouldGateFileOpenBySize } from "../services/largeFileOpen";
import { appState } from "../state/appState";

export async function openAndStoreFile(
  notify: (message: string) => void,
  windowId: string,
  opened: { path: string; content: string; sizeBytes: number; contentKind: "text" | "image" | "binary" } | null,
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
      const fingerprint = await statDiskFingerprint(opened.path);
      appState.upgradeDocumentFromOpenedFile(gateResult.documentId, opened.path, "", "large_pending");
      appState.setDocumentDiskState(gateResult.documentId, {
        diskFingerprint: fingerprint,
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
    );
    await initializeDocumentDiskState(gateResult.documentId, opened.path);
    notify(`Opened ${opened.path}`);
    return;
  }

  if (needsConfirm) {
    const fingerprint = await statDiskFingerprint(opened.path);
    await completeLargePendingOpen(opened.path, fingerprint, windowId);
    notify(`Opened ${opened.path} (confirm to load contents)`);
    return;
  }

  await completeOpenPath(opened.path, opened.content, windowId, opened.contentKind);
  notify(`Opened ${opened.path}`);
}
