import type { DiskFingerprint, ExternalFilesSettings } from "../domain/contracts";
import { getSessionActiveTab, getSessionTabs, isFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import { getActiveDocuments, getActiveSession } from "../state/appState/contextHelpers";
import { isFileMissingError, isFsScopePermissionError, normalizePathSync, statDiskFingerprint } from "./diskFingerprint";
import { removeInaccessibleDocumentTab } from "./inaccessibleFileTabs";
import { shouldAttemptDeferredCheck, shouldRunAutomaticCheck } from "./externalFileReloadPolicy";
import type { ExternalCheckResult, ExternalCheckTrigger } from "./externalFileChangesTypes";
import {
  checkDocumentExternalChangesWithRuntime,
  flushDirtyPrompts,
  reloadActiveDocumentFromDiskWithRuntime,
} from "./externalFileChangesRuntime";
import { mapWithConcurrency } from "./mapWithConcurrency";
import { elapsedMs, logPerfTiming, nowMs } from "./perfDiagnostics";
import { getErrorMessage } from "../commands/commandErrors";

export type { ExternalCheckResult, ExternalCheckTrigger } from "./externalFileChangesTypes";

/** Max in-flight disk stats while draining deferred startup checks. */
const STARTUP_EXTERNAL_CHECK_CONCURRENCY = 4;
/** Yield to the event loop between batches so large tab sets stay responsive. */
const STARTUP_EXTERNAL_CHECK_BATCH_SIZE = 8;

const deferredDirtyDocumentIds = new Set<string>();
const runtimeState = {
  lastWriteFingerprintByPath: new Map<string, DiskFingerprint>(),
  dialogOpenForDocument: new Set<string>(),
  pendingDirtyPromptByDocument: new Map<
    string,
    { trigger: ExternalCheckTrigger; diskFingerprint: DiskFingerprint }
  >(),
  inFlightCheckByDocument: new Map<string, Promise<ExternalCheckResult>>(),
  flushingDirtyPrompts: false,
};

let backgroundStartupChecks: Promise<void> | null = null;

/** Clears module-level state between unit tests. */
export function resetExternalFileChangesForTests(): void {
  runtimeState.lastWriteFingerprintByPath.clear();
  runtimeState.dialogOpenForDocument.clear();
  deferredDirtyDocumentIds.clear();
  runtimeState.inFlightCheckByDocument.clear();
  runtimeState.pendingDirtyPromptByDocument.clear();
  runtimeState.flushingDirtyPrompts = false;
  backgroundStartupChecks = null;
}

/** Await deferred startup external checks (tests / diagnostics). */
export function awaitStartupExternalChecksBackgroundForTests(): Promise<void> {
  return backgroundStartupChecks ?? Promise.resolve();
}

export function shouldSyncFileWatcher(settings: ExternalFilesSettings): boolean {
  return settings.watchExternalChanges;
}

export { shouldRunAutomaticCheck } from "./externalFileReloadPolicy";

export function recordWriteFingerprint(path: string, fingerprint: DiskFingerprint): void {
  runtimeState.lastWriteFingerprintByPath.set(normalizePathSync(path), fingerprint);
}

export async function recordWriteFingerprintFromPath(path: string): Promise<DiskFingerprint> {
  const fingerprint = await statDiskFingerprint(path);
  recordWriteFingerprint(path, fingerprint);
  return fingerprint;
}

export async function initializeDocumentDiskState(
  documentId: string,
  filePath: string,
): Promise<void> {
  try {
    const fingerprint = await statDiskFingerprint(filePath);
    appState.setDocumentDiskState(documentId, {
      diskFingerprint: fingerprint,
      fileMissing: false,
    });
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      appState.setDocumentDiskState(documentId, {
        diskFingerprint: null,
        fileMissing: true,
      });
      return;
    }
    if (isFsScopePermissionError(error)) {
      removeInaccessibleDocumentTab(documentId, filePath, error);
      return;
    }
    throw error;
  }
}

export async function checkDocumentExternalChanges(
  documentId: string,
  trigger: ExternalCheckTrigger,
): Promise<ExternalCheckResult> {
  return checkDocumentExternalChangesWithRuntime(
    runtimeState,
    deferredDirtyDocumentIds,
    documentId,
    trigger,
  );
}

export async function checkDocumentIfDeferred(
  documentId: string,
  trigger: "focus" | "tab",
): Promise<ExternalCheckResult> {
  if (shouldAttemptDeferredCheck(deferredDirtyDocumentIds.has(documentId), trigger)) {
    deferredDirtyDocumentIds.delete(documentId);
  }
  const result = await checkDocumentExternalChanges(documentId, trigger);
  await flushDirtyPrompts(runtimeState, deferredDirtyDocumentIds);
  return result;
}

/**
 * Startup external-change scan: check the active file tab first (blocking),
 * then drain remaining file tabs in background batches so large restored
 * sessions reach interactive sooner. Dirty buffers stay deferred (no dialogs).
 */
export async function runStartupExternalChecks(): Promise<void> {
  const snapshot = appState.getSnapshot();
  if (!shouldRunAutomaticCheck(snapshot.settings.externalFiles, "startup")) {
    return;
  }

  const session = getActiveSession(snapshot);
  const fileDocumentIds: string[] = [];
  for (const tab of getSessionTabs(session)) {
    if (isFileTab(tab)) {
      fileDocumentIds.push(tab.documentId);
    }
  }
  if (fileDocumentIds.length === 0) {
    return;
  }

  const activeTab = getSessionActiveTab(session);
  const activeDocumentId =
    activeTab && isFileTab(activeTab) ? activeTab.documentId : null;

  const priorityIds: string[] = [];
  const deferredIds: string[] = [];
  for (const documentId of fileDocumentIds) {
    if (activeDocumentId && documentId === activeDocumentId && priorityIds.length === 0) {
      priorityIds.push(documentId);
    } else {
      deferredIds.push(documentId);
    }
  }

  const priorityStartedAt = nowMs();
  for (const documentId of priorityIds) {
    try {
      await checkDocumentExternalChanges(documentId, "startup");
    } catch {
      // Keep startup robust when an individual check fails.
    }
  }
  await logPerfTiming("startup external checks priority complete", {
    metric: "startup.phase",
    label: "startup-external-checks-priority",
    durationMs: elapsedMs(priorityStartedAt),
    priorityCount: priorityIds.length,
    deferredCount: deferredIds.length,
    ok: true,
  });

  if (deferredIds.length === 0) {
    return;
  }

  const deferredStartedAt = nowMs();
  const deferredCount = deferredIds.length;
  backgroundStartupChecks = (async () => {
    try {
      for (let offset = 0; offset < deferredIds.length; offset += STARTUP_EXTERNAL_CHECK_BATCH_SIZE) {
        const batch = deferredIds.slice(offset, offset + STARTUP_EXTERNAL_CHECK_BATCH_SIZE);
        await mapWithConcurrency(batch, STARTUP_EXTERNAL_CHECK_CONCURRENCY, async (documentId) => {
          try {
            await checkDocumentExternalChanges(documentId, "startup");
          } catch {
            // Individual failures must not abort the rest of the drain.
          }
        });
        if (offset + STARTUP_EXTERNAL_CHECK_BATCH_SIZE < deferredIds.length) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
          });
        }
      }
      await logPerfTiming("startup external checks background complete", {
        metric: "startup.phase",
        label: "startup-external-checks-background",
        durationMs: elapsedMs(deferredStartedAt),
        deferredCount,
        ok: true,
      });
    } catch (error: unknown) {
      await logPerfTiming(
        "startup external checks background failed",
        {
          metric: "startup.phase",
          label: "startup-external-checks-background",
          durationMs: elapsedMs(deferredStartedAt),
          deferredCount,
          ok: false,
          error: getErrorMessage(error, String(error)),
        },
        "info",
      );
    }
  })();
}

export async function runFocusExternalChecks(): Promise<void> {
  const snapshot = appState.getSnapshot();
  if (!shouldRunAutomaticCheck(snapshot.settings.externalFiles, "focus")) {
    return;
  }
  for (const tab of getSessionTabs(getActiveSession(snapshot))) {
    if (isFileTab(tab)) {
      await checkDocumentIfDeferred(tab.documentId, "focus");
    }
  }
  await flushDirtyPrompts(runtimeState, deferredDirtyDocumentIds);
}

export async function runWatcherExternalCheck(normalizedOrRawPath: string): Promise<void> {
  const snapshot = appState.getSnapshot();
  if (!shouldRunAutomaticCheck(snapshot.settings.externalFiles, "watcher")) {
    return;
  }
  const normalized = normalizePathSync(normalizedOrRawPath);
  for (const tab of getSessionTabs(getActiveSession(snapshot))) {
    if (!isFileTab(tab)) {
      continue;
    }
    const documentState = getActiveDocuments(snapshot).find((doc) => doc.id === tab.documentId);
    if (documentState?.filePath && normalizePathSync(documentState.filePath) === normalized) {
      await checkDocumentExternalChanges(documentState.id, "watcher");
      await flushDirtyPrompts(runtimeState, deferredDirtyDocumentIds);
      return;
    }
  }
}

export function collectOpenFilePaths(): string[] {
  const snapshot = appState.getSnapshot();
  const paths = new Set<string>();
  for (const tab of getSessionTabs(getActiveSession(snapshot))) {
    if (!isFileTab(tab)) {
      continue;
    }
    const documentState = getActiveDocuments(snapshot).find((doc) => doc.id === tab.documentId);
    if (documentState?.filePath) {
      paths.add(documentState.filePath);
    }
  }
  return [...paths];
}

export async function reloadActiveDocumentFromDisk(): Promise<ExternalCheckResult> {
  return reloadActiveDocumentFromDiskWithRuntime(runtimeState, deferredDirtyDocumentIds);
}
