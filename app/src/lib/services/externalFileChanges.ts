import type { DiskFingerprint, ExternalFilesSettings } from "../domain/contracts";
import { isFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import { getActiveDocuments, getActiveSession } from "../state/appState/contextHelpers";
import { isFileMissingError, normalizePathSync, statDiskFingerprint } from "./diskFingerprint";
import { shouldAttemptDeferredCheck, shouldRunAutomaticCheck } from "./externalFileReloadPolicy";
import type { ExternalCheckResult, ExternalCheckTrigger } from "./externalFileChangesTypes";
import {
  checkDocumentExternalChangesWithRuntime,
  flushDirtyPrompts,
  reloadActiveDocumentFromDiskWithRuntime,
} from "./externalFileChangesRuntime";

export type { ExternalCheckResult, ExternalCheckTrigger } from "./externalFileChangesTypes";

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

/** Clears module-level state between unit tests. */
export function resetExternalFileChangesForTests(): void {
  runtimeState.lastWriteFingerprintByPath.clear();
  runtimeState.dialogOpenForDocument.clear();
  deferredDirtyDocumentIds.clear();
  runtimeState.inFlightCheckByDocument.clear();
  runtimeState.pendingDirtyPromptByDocument.clear();
  runtimeState.flushingDirtyPrompts = false;
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

export async function runStartupExternalChecks(): Promise<void> {
  const snapshot = appState.getSnapshot();
  if (!shouldRunAutomaticCheck(snapshot.settings.externalFiles, "startup")) {
    return;
  }
  for (const tab of getActiveSession(snapshot).openTabs) {
    if (isFileTab(tab)) {
      await checkDocumentExternalChanges(tab.documentId, "startup");
    }
  }
}

export async function runFocusExternalChecks(): Promise<void> {
  const snapshot = appState.getSnapshot();
  if (!shouldRunAutomaticCheck(snapshot.settings.externalFiles, "focus")) {
    return;
  }
  for (const tab of getActiveSession(snapshot).openTabs) {
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
  for (const tab of getActiveSession(snapshot).openTabs) {
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
  for (const tab of getActiveSession(snapshot).openTabs) {
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
