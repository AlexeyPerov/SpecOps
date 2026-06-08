import { confirm } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { DiskFingerprint } from "../domain/contracts";
import { appState } from "../state/appState";
import { getActiveDocuments, getActiveSession } from "../state/appState/contextHelpers";
import {
  diskChanged,
  fingerprintsEqual,
  isFileMissingError,
  normalizePathSync,
  shouldSkipAsDismissed,
  statDiskFingerprint,
} from "./diskFingerprint";
import { resolveExternalReloadPolicy, shouldRunAutomaticCheck } from "./externalFileReloadPolicy";
import type { ExternalCheckResult, ExternalCheckTrigger } from "./externalFileChangesTypes";

type RuntimeState = {
  lastWriteFingerprintByPath: Map<string, DiskFingerprint>;
  dialogOpenForDocument: Set<string>;
  pendingDirtyPromptByDocument: Map<
    string,
    { trigger: ExternalCheckTrigger; diskFingerprint: DiskFingerprint }
  >;
  inFlightCheckByDocument: Map<string, Promise<ExternalCheckResult>>;
  flushingDirtyPrompts: boolean;
};

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

async function reloadDocumentFromDisk(documentId: string, filePath: string): Promise<void> {
  const content = await readTextFile(filePath);
  const fingerprint = await statDiskFingerprint(filePath);
  appState.applyDocumentDiskReload(documentId, content, fingerprint);
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
      const documentState = getActiveDocuments(snapshot).find((doc) => doc.id === documentId);
      if (!documentState?.filePath || !documentState.isDirty) {
        runtime.pendingDirtyPromptByDocument.delete(documentId);
        continue;
      }

      if (runtime.dialogOpenForDocument.has(documentId)) {
        continue;
      }

      let currentFingerprint: DiskFingerprint;
      try {
        currentFingerprint = await statDiskFingerprint(documentState.filePath);
      } catch (error: unknown) {
        if (isFileMissingError(error)) {
          runtime.pendingDirtyPromptByDocument.delete(documentId);
          if (!documentState.fileMissing) {
            appState.setDocumentDiskState(documentId, {
              diskFingerprint: documentState.diskFingerprint,
              fileMissing: true,
            });
          }
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
        if (choice === "reload") {
          await reloadDocumentFromDisk(documentId, documentState.filePath);
          deferredDirtyDocumentIds.delete(documentId);
        } else {
          appState.applyDocumentKeepLocal(documentId, currentFingerprint);
          deferredDirtyDocumentIds.delete(documentId);
        }
      } catch {
        runtime.pendingDirtyPromptByDocument.set(documentId, {
          trigger: pending.trigger,
          diskFingerprint: currentFingerprint,
        });
        break;
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
  const documentState = getActiveDocuments(snapshot).find((doc) => doc.id === documentId);
  if (!documentState?.filePath) {
    return "skipped";
  }

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

  let currentFingerprint: DiskFingerprint;
  try {
    currentFingerprint = await statDiskFingerprint(documentState.filePath);
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      if (!documentState.fileMissing) {
        appState.setDocumentDiskState(documentId, {
          diskFingerprint: documentState.diskFingerprint,
          fileMissing: true,
        });
      }
      return "missing";
    }
    throw error;
  }

  if (documentState.fileMissing) {
    appState.setDocumentDiskState(documentId, {
      diskFingerprint: currentFingerprint,
      fileMissing: false,
    });
  }

  if (matchesLastWrite(runtime, documentState.filePath, currentFingerprint)) {
    return "unchanged";
  }

  if (shouldSkipAsDismissed(documentState.dismissedFingerprint, currentFingerprint)) {
    return "unchanged";
  }

  if (
    !diskChanged(documentState.diskFingerprint, currentFingerprint) &&
    !documentState.fileMissing
  ) {
    return "unchanged";
  }

  const policy = resolveExternalReloadPolicy({
    trigger,
    isDirty: documentState.isDirty,
    autoReloadCleanFiles: snapshot.settings.externalFiles.autoReloadCleanFiles,
  });
  if (policy === "reloaded") {
    await reloadDocumentFromDisk(documentId, documentState.filePath);
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
  const selectedTab = getActiveSession(snapshot).openTabs.find(
    (tab) => tab.id === getActiveSession(snapshot).selectedTabId,
  );
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
      await reloadDocumentFromDisk(documentState.id, documentState.filePath);
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
