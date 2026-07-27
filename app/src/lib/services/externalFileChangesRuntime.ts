import { confirm } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import type { ContextId, DiskFingerprint } from "../domain/contracts";
import { getSessionActiveTab } from "../domain/contracts";
import { appState } from "../state/appState";
import {
  findDocumentContext,
  getActiveDocuments,
  getActiveSession,
} from "../state/appState/contextHelpers";
import {
  diskChanged,
  fingerprintsEqual,
  hashFileBytes,
  isFileMissingError,
  isFsScopePermissionError,
  needsContentHashVerification,
  normalizePathSync,
  shouldSkipAsDismissed,
  statDiskFingerprint,
  statDiskFingerprintWithContent,
} from "./diskFingerprint";
import { resolveExternalReloadPolicy, shouldRunAutomaticCheck } from "./externalFileReloadPolicy";
import type { ExternalCheckResult, ExternalCheckTrigger } from "./externalFileChangesTypes";
import { removeInaccessibleDocumentTab } from "./inaccessibleFileTabs";
import { inferFileContentKind } from "./fileContentKind";
import { shouldGateFileOpenBySize } from "./largeFileOpen";
import {
  DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES,
  resolveBinaryFileOpen,
} from "./binaryFileOpen";
import { decodeTextFile } from "./textEncoding";

type RuntimeState = {
  lastWriteFingerprintByPath: Map<string, DiskFingerprint>;
  dialogOpenForDocument: Set<string>;
  pendingDirtyPromptByDocument: Map<
    string,
    { trigger: ExternalCheckTrigger; diskFingerprint: DiskFingerprint }
  >;
  inFlightCheckByDocument: Map<string, Promise<ExternalCheckResult>>;
  flushingDirtyPrompts: boolean;
  /**
   * Refcount of in-flight app saves per path; see
   * externalFileChanges.beginSaveInFlight.
   */
  saveInFlightByPath: Map<string, number>;
};

function isSaveInFlight(runtime: RuntimeState, path: string): boolean {
  return (runtime.saveInFlightByPath.get(normalizePathSync(path)) ?? 0) > 0;
}

function matchesLastWrite(runtime: RuntimeState, path: string, fingerprint: DiskFingerprint): boolean {
  const lastWrite = runtime.lastWriteFingerprintByPath.get(normalizePathSync(path));
  return lastWrite !== undefined && fingerprintsEqual(lastWrite, fingerprint);
}

async function promptReloadOrKeep(title: string): Promise<"reload" | "keep"> {
  const reload = await confirm(
    `"${title}" has been modified on disk. Reload from disk and discard your unsaved changes?`,
    {
      title: "External File Change",
      okLabel: "Reload",
      cancelLabel: "Keep Local",
    },
  );
  return reload ? "reload" : "keep";
}

async function reloadDocumentFromDisk(
  contextId: ContextId,
  documentId: string,
  filePath: string,
): Promise<void> {
  // Same guards as openPath (size / binary / image / BOM), without importing
  // fileSystem (that module already depends on the external-change runtime).
  // Stat → read → re-stat so the fingerprint belongs to the decoded bytes —
  // a write between a bare read and a later metadata-only stat permanently
  // hid the change.
  const { fingerprint, bytes } = await statDiskFingerprintWithContent(filePath, readFile);
  const maxOpenWithoutConfirmBytes =
    appState.getSnapshot().settings.externalFiles.maxOpenWithoutConfirmBytes;
  if (shouldGateFileOpenBySize(filePath, fingerprint.sizeBytes, maxOpenWithoutConfirmBytes)) {
    appState.applyDocumentDiskReloadForContext(
      contextId,
      documentId,
      "",
      fingerprint,
      undefined,
      "large_pending",
    );
    return;
  }

  const contentKind = inferFileContentKind(filePath, bytes);
  if (contentKind === "image") {
    return;
  }
  if (contentKind === "binary") {
    const maxBinaryOpenAsTextBytes =
      appState.getSnapshot().settings.externalFiles.maxBinaryOpenAsTextBytes ??
      DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES;
    const resolved = resolveBinaryFileOpen(fingerprint.sizeBytes, maxBinaryOpenAsTextBytes);
    if (resolved.contentKind !== "text") {
      return;
    }
  }

  const decoded = decodeTextFile(bytes);
  if (!decoded) {
    // The file is no longer valid UTF-8 text. Leave the buffer alone rather than
    // replacing it with a lossy decode the user would then save back.
    return;
  }
  appState.applyDocumentDiskReloadForContext(
    contextId,
    documentId,
    decoded.content,
    fingerprint,
    { lineEnding: decoded.lineEnding, hasBom: decoded.hasBom },
  );
}

function scheduleFlushDirtyPrompts(
  runtime: RuntimeState,
  deferredDirtyDocumentIds: Set<string>,
): void {
  queueMicrotask(() => {
    void flushDirtyPrompts(runtime, deferredDirtyDocumentIds);
  });
}

export async function flushDirtyPrompts(
  runtime: RuntimeState,
  deferredDirtyDocumentIds: Set<string>,
): Promise<void> {
  if (runtime.flushingDirtyPrompts) {
    return;
  }
  runtime.flushingDirtyPrompts = true;
  try {
    for (const documentId of [...runtime.pendingDirtyPromptByDocument.keys()]) {
      const pending = runtime.pendingDirtyPromptByDocument.get(documentId);
      if (!pending) {
        continue;
      }

      const snapshot = appState.getSnapshot();
      const owner = findDocumentContext(snapshot, documentId);
      const filePath = owner?.document.filePath ?? null;
      // Staleness guard: the document may have been closed, renamed, or its
      // owning context pruned while the prompt was queued. Cancel gracefully
      // rather than reloading a path that no longer belongs to the document.
      if (!owner || !filePath || !owner.document.isDirty) {
        runtime.pendingDirtyPromptByDocument.delete(documentId);
        continue;
      }
      const { contextId, document: documentState } = owner;

      if (runtime.dialogOpenForDocument.has(documentId)) {
        continue;
      }

      let currentFingerprint: DiskFingerprint;
      try {
        currentFingerprint = await statDiskFingerprint(filePath);
      } catch (error: unknown) {
        if (isFileMissingError(error)) {
          runtime.pendingDirtyPromptByDocument.delete(documentId);
          if (!documentState.fileMissing) {
            appState.setDocumentDiskStateForContext(contextId, documentId, {
              diskFingerprint: documentState.diskFingerprint,
              fileMissing: true,
            });
          }
          continue;
        }
        if (isFsScopePermissionError(error)) {
          runtime.pendingDirtyPromptByDocument.delete(documentId);
          removeInaccessibleDocumentTab(documentId, filePath, error);
          continue;
        }
        throw error;
      }

      if (shouldSkipAsDismissed(documentState.dismissedFingerprint, currentFingerprint)) {
        runtime.pendingDirtyPromptByDocument.delete(documentId);
        continue;
      }

      if (
        !diskChanged(documentState.diskFingerprint, currentFingerprint) &&
        !documentState.fileMissing
      ) {
        runtime.pendingDirtyPromptByDocument.delete(documentId);
        continue;
      }

      runtime.pendingDirtyPromptByDocument.delete(documentId);
      runtime.dialogOpenForDocument.add(documentId);
      try {
        const choice = await promptReloadOrKeep(documentState.title);
        // Re-read after the async dialog: if the tab was closed, the path
        // renamed, or the context gone, cancel the reload instead of touching
        // a stale path.
        const postDialog = findDocumentContext(appState.getSnapshot(), documentId);
        if (!postDialog || postDialog.document.filePath !== filePath) {
          deferredDirtyDocumentIds.delete(documentId);
          continue;
        }
        if (choice === "reload") {
          await reloadDocumentFromDisk(contextId, documentId, filePath);
          deferredDirtyDocumentIds.delete(documentId);
        } else {
          appState.applyDocumentKeepLocalForContext(
            postDialog.contextId,
            documentId,
            currentFingerprint,
          );
          deferredDirtyDocumentIds.delete(documentId);
        }
      } catch {
        // Dialog rejection must not re-queue: the outer finally would
        // scheduleFlushDirtyPrompts again via queueMicrotask and spin forever
        // (one stat IPC per iteration). Treat failure like Keep Local so the
        // buffer is preserved and the fingerprint is dismissed.
        const postDialog = findDocumentContext(appState.getSnapshot(), documentId);
        if (postDialog && postDialog.document.filePath === filePath) {
          appState.applyDocumentKeepLocalForContext(
            postDialog.contextId,
            documentId,
            currentFingerprint,
          );
        }
        deferredDirtyDocumentIds.delete(documentId);
      } finally {
        runtime.dialogOpenForDocument.delete(documentId);
      }
    }
  } finally {
    runtime.flushingDirtyPrompts = false;
    if (runtime.pendingDirtyPromptByDocument.size > 0) {
      scheduleFlushDirtyPrompts(runtime, deferredDirtyDocumentIds);
    }
  }
}

export async function checkDocumentExternalChangesWithRuntime(
  runtime: RuntimeState,
  deferredDirtyDocumentIds: Set<string>,
  documentId: string,
  trigger: ExternalCheckTrigger,
): Promise<ExternalCheckResult> {
  const inFlight = runtime.inFlightCheckByDocument.get(documentId);
  if (inFlight) {
    return inFlight;
  }

  let resolveCheck!: (result: ExternalCheckResult) => void;
  let rejectCheck!: (error: unknown) => void;
  const checkPromise = new Promise<ExternalCheckResult>((resolve, reject) => {
    resolveCheck = resolve;
    rejectCheck = reject;
  });
  runtime.inFlightCheckByDocument.set(documentId, checkPromise);

  void checkDocumentExternalChangesInner(runtime, deferredDirtyDocumentIds, documentId, trigger)
    .then(resolveCheck, rejectCheck)
    .finally(() => {
      if (runtime.inFlightCheckByDocument.get(documentId) === checkPromise) {
        runtime.inFlightCheckByDocument.delete(documentId);
      }
    });

  return checkPromise;
}

async function checkDocumentExternalChangesInner(
  runtime: RuntimeState,
  deferredDirtyDocumentIds: Set<string>,
  documentId: string,
  trigger: ExternalCheckTrigger,
): Promise<ExternalCheckResult> {
  const snapshot = appState.getSnapshot();
  const owner = findDocumentContext(snapshot, documentId);
  const filePath = owner?.document.filePath ?? null;
  if (!owner || !filePath) {
    return "skipped";
  }
  const { contextId } = owner;
  let documentState = owner.document;

  if (documentState.contentKind !== "text") {
    return "skipped";
  }

  if (trigger !== "manual" && !shouldRunAutomaticCheck(snapshot.settings.externalFiles, trigger)) {
    return "skipped";
  }

  if (runtime.dialogOpenForDocument.has(documentId)) {
    return "skipped";
  }

  if (runtime.pendingDirtyPromptByDocument.has(documentId)) {
    return "deferred";
  }

  // Guard the save/watcher race: an app-initiated write may already be in
  // flight (between the disk write and the fingerprint record). Suppress the
  // check so the app's own write does not echo back as an external change.
  if (isSaveInFlight(runtime, filePath)) {
    return "unchanged";
  }

  let currentFingerprint: DiskFingerprint;
  try {
    currentFingerprint = await statDiskFingerprint(filePath);
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      const missingOwner = findDocumentContext(appState.getSnapshot(), documentId);
      if (missingOwner && !missingOwner.document.fileMissing) {
        appState.setDocumentDiskStateForContext(missingOwner.contextId, documentId, {
          diskFingerprint: missingOwner.document.diskFingerprint,
          fileMissing: true,
        });
      }
      return "missing";
    }
    if (isFsScopePermissionError(error)) {
      removeInaccessibleDocumentTab(documentId, filePath, error);
      return "skipped";
    }
    throw error;
  }

  // Re-read after the stat await: the user may have typed (now dirty) or saved
  // while we were waiting. Auto-reload decisions must use the live dirtiness.
  const freshOwner = findDocumentContext(appState.getSnapshot(), documentId);
  if (!freshOwner || freshOwner.document.filePath !== filePath) {
    return "skipped";
  }
  documentState = freshOwner.document;
  const liveContextId = freshOwner.contextId;

  if (documentState.fileMissing) {
    appState.setDocumentDiskStateForContext(liveContextId, documentId, {
      diskFingerprint: currentFingerprint,
      fileMissing: false,
    });
  }

  if (matchesLastWrite(runtime, filePath, currentFingerprint)) {
    return "unchanged";
  }

  if (shouldSkipAsDismissed(documentState.dismissedFingerprint, currentFingerprint)) {
    return "unchanged";
  }

  let changed =
    diskChanged(documentState.diskFingerprint, currentFingerprint) || documentState.fileMissing;

  // Metadata matched, but a watcher event (or a size-only fingerprint) can still
  // mean a same-size edit within one mtime tick. Re-hash when we have a known hash.
  if (
    !changed &&
    documentState.diskFingerprint &&
    needsContentHashVerification(documentState.diskFingerprint, trigger)
  ) {
    try {
      const bytes = await readFile(filePath);
      const contentHash = await hashFileBytes(bytes);
      currentFingerprint = { ...currentFingerprint, contentHash };
      if (documentState.diskFingerprint.contentHash !== contentHash) {
        changed = true;
      }
    } catch (error: unknown) {
      if (isFileMissingError(error)) {
        appState.setDocumentDiskStateForContext(liveContextId, documentId, {
          diskFingerprint: documentState.diskFingerprint,
          fileMissing: true,
        });
        return "missing";
      }
      if (isFsScopePermissionError(error)) {
        removeInaccessibleDocumentTab(documentId, filePath, error);
        return "skipped";
      }
      throw error;
    }

    // Typing during the content verify must also defer auto-reload.
    const afterHashOwner = findDocumentContext(appState.getSnapshot(), documentId);
    if (!afterHashOwner || afterHashOwner.document.filePath !== filePath) {
      return "skipped";
    }
    documentState = afterHashOwner.document;
  }

  if (!changed) {
    return "unchanged";
  }

  const policy = resolveExternalReloadPolicy({
    trigger,
    isDirty: documentState.isDirty,
    autoReloadCleanFiles: appState.getSnapshot().settings.externalFiles.autoReloadCleanFiles,
  });
  if (policy === "reloaded") {
    await reloadDocumentFromDisk(liveContextId, documentId, filePath);
    return "reloaded";
  }
  if (policy === "skipped") {
    return "skipped";
  }
  if (trigger === "startup") {
    deferredDirtyDocumentIds.add(documentId);
    return "deferred";
  }

  runtime.pendingDirtyPromptByDocument.set(documentId, {
    trigger,
    diskFingerprint: currentFingerprint,
  });
  scheduleFlushDirtyPrompts(runtime, deferredDirtyDocumentIds);
  return "deferred";
}

export async function reloadActiveDocumentFromDiskWithRuntime(
  runtime: RuntimeState,
  deferredDirtyDocumentIds: Set<string>,
): Promise<ExternalCheckResult> {
  const snapshot = appState.getSnapshot();
  const selectedTab = getSessionActiveTab(getActiveSession(snapshot));
  if (!selectedTab) {
    return "skipped";
  }

  const selectedDocumentId = selectedTab.kind === "file" ? selectedTab.documentId : null;
  if (!selectedDocumentId) {
    return "skipped";
  }

  const documentState = getActiveDocuments(snapshot).find((doc) => doc.id === selectedDocumentId);
  if (!documentState?.filePath) {
    return "skipped";
  }

  if (!documentState.isDirty) {
    try {
      await reloadDocumentFromDisk(snapshot.contexts.activeContextId, documentState.id, documentState.filePath);
      return "reloaded";
    } catch (error: unknown) {
      if (isFileMissingError(error)) {
        appState.setDocumentDiskState(documentState.id, {
          diskFingerprint: documentState.diskFingerprint,
          fileMissing: true,
        });
        return "missing";
      }
      throw error;
    }
  }

  const result = await checkDocumentExternalChangesWithRuntime(
    runtime,
    deferredDirtyDocumentIds,
    documentState.id,
    "manual",
  );
  await flushDirtyPrompts(runtime, deferredDirtyDocumentIds);
  return result;
}
