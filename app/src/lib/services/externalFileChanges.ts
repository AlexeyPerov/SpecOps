import { confirm } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { DiskFingerprint, ExternalFilesSettings } from "../domain/contracts";
import { isFileTab, tabDocumentId } from "../domain/contracts";
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

export type ExternalCheckTrigger = "watcher" | "focus" | "tab" | "startup" | "manual";

export type ExternalCheckResult =
  | "unchanged"
  | "reloaded"
  | "kept"
  | "missing"
  | "skipped"
  | "deferred";

const lastWriteFingerprintByPath = new Map<string, DiskFingerprint>();
const dialogOpenForDocument = new Set<string>();
const deferredDirtyDocumentIds = new Set<string>();
const inFlightCheckByDocument = new Map<string, Promise<ExternalCheckResult>>();
const pendingDirtyPromptByDocument = new Map<
  string,
  { trigger: ExternalCheckTrigger; diskFingerprint: DiskFingerprint }
>();
let flushingDirtyPrompts = false;

/** Clears module-level state between unit tests. */
export function resetExternalFileChangesForTests(): void {
  lastWriteFingerprintByPath.clear();
  dialogOpenForDocument.clear();
  deferredDirtyDocumentIds.clear();
  inFlightCheckByDocument.clear();
  pendingDirtyPromptByDocument.clear();
  flushingDirtyPrompts = false;
}

export function shouldSyncFileWatcher(settings: ExternalFilesSettings): boolean {
  return settings.watchExternalChanges;
}

export function shouldRunAutomaticCheck(
  settings: ExternalFilesSettings,
  trigger: Exclude<ExternalCheckTrigger, "manual">,
): boolean {
  if (!settings.watchExternalChanges) {
    return false;
  }
  switch (trigger) {
    case "watcher":
      return true;
    case "focus":
      return settings.checkOnWindowFocus;
    case "tab":
      return settings.checkOnTabActivate;
    case "startup":
      return true;
    default:
      return false;
  }
}

export function recordWriteFingerprint(path: string, fingerprint: DiskFingerprint): void {
  lastWriteFingerprintByPath.set(normalizePathSync(path), fingerprint);
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

function matchesLastWrite(path: string, fingerprint: DiskFingerprint): boolean {
  const lastWrite = lastWriteFingerprintByPath.get(normalizePathSync(path));
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

function scheduleFlushDirtyPrompts(): void {
  queueMicrotask(() => {
    void flushDirtyPrompts();
  });
}

async function flushDirtyPrompts(): Promise<void> {
  if (flushingDirtyPrompts) {
    return;
  }
  flushingDirtyPrompts = true;
  try {
    for (const documentId of [...pendingDirtyPromptByDocument.keys()]) {
      const pending = pendingDirtyPromptByDocument.get(documentId);
      if (!pending) {
        continue;
      }

      const snapshot = appState.getSnapshot();
      const documentState = getActiveDocuments(snapshot).find((doc) => doc.id === documentId);
      if (!documentState?.filePath || !documentState.isDirty) {
        pendingDirtyPromptByDocument.delete(documentId);
        continue;
      }

      if (dialogOpenForDocument.has(documentId)) {
        continue;
      }

      let currentFingerprint: DiskFingerprint;
      try {
        currentFingerprint = await statDiskFingerprint(documentState.filePath);
      } catch (error: unknown) {
        if (isFileMissingError(error)) {
          pendingDirtyPromptByDocument.delete(documentId);
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
        pendingDirtyPromptByDocument.delete(documentId);
        continue;
      }

      if (
        !diskChanged(documentState.diskFingerprint, currentFingerprint) &&
        !documentState.fileMissing
      ) {
        pendingDirtyPromptByDocument.delete(documentId);
        continue;
      }

      pendingDirtyPromptByDocument.delete(documentId);
      dialogOpenForDocument.add(documentId);
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
        pendingDirtyPromptByDocument.set(documentId, {
          trigger: pending.trigger,
          diskFingerprint: currentFingerprint,
        });
        break;
      } finally {
        dialogOpenForDocument.delete(documentId);
      }
    }
  } finally {
    flushingDirtyPrompts = false;
    if (pendingDirtyPromptByDocument.size > 0) {
      scheduleFlushDirtyPrompts();
    }
  }
}

async function reloadDocumentFromDisk(
  documentId: string,
  filePath: string,
): Promise<void> {
  const content = await readTextFile(filePath);
  const fingerprint = await statDiskFingerprint(filePath);
  appState.applyDocumentDiskReload(documentId, content, fingerprint);
}

export async function checkDocumentExternalChanges(
  documentId: string,
  trigger: ExternalCheckTrigger,
): Promise<ExternalCheckResult> {
  const inFlight = inFlightCheckByDocument.get(documentId);
  if (inFlight) {
    return inFlight;
  }

  let resolveCheck!: (result: ExternalCheckResult) => void;
  let rejectCheck!: (error: unknown) => void;
  const checkPromise = new Promise<ExternalCheckResult>((resolve, reject) => {
    resolveCheck = resolve;
    rejectCheck = reject;
  });
  inFlightCheckByDocument.set(documentId, checkPromise);

  void checkDocumentExternalChangesInner(documentId, trigger)
    .then(resolveCheck, rejectCheck)
    .finally(() => {
      if (inFlightCheckByDocument.get(documentId) === checkPromise) {
        inFlightCheckByDocument.delete(documentId);
      }
    });

  return checkPromise;
}

async function checkDocumentExternalChangesInner(
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

  if (dialogOpenForDocument.has(documentId)) {
    return "skipped";
  }

  if (pendingDirtyPromptByDocument.has(documentId)) {
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

  if (matchesLastWrite(documentState.filePath, currentFingerprint)) {
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

  const { externalFiles } = snapshot.settings;

  if (!documentState.isDirty) {
    if (trigger === "manual" || externalFiles.autoReloadCleanFiles) {
      await reloadDocumentFromDisk(documentId, documentState.filePath);
      return "reloaded";
    }
    return "skipped";
  }

  if (trigger === "startup") {
    deferredDirtyDocumentIds.add(documentId);
    return "deferred";
  }

  pendingDirtyPromptByDocument.set(documentId, {
    trigger,
    diskFingerprint: currentFingerprint,
  });
  scheduleFlushDirtyPrompts();
  return "deferred";
}

export async function checkDocumentIfDeferred(
  documentId: string,
  trigger: "focus" | "tab",
): Promise<ExternalCheckResult> {
  if (deferredDirtyDocumentIds.has(documentId)) {
    deferredDirtyDocumentIds.delete(documentId);
  }
  const result = await checkDocumentExternalChanges(documentId, trigger);
  await flushDirtyPrompts();
  return result;
}

export async function runStartupExternalChecks(): Promise<void> {
  const snapshot = appState.getSnapshot();
  if (!shouldRunAutomaticCheck(snapshot.settings.externalFiles, "startup")) {
    return;
  }

  for (const tab of getActiveSession(snapshot).openTabs) {
    if (!isFileTab(tab)) {
      continue;
    }
    await checkDocumentExternalChanges(tab.documentId, "startup");
  }
}

export async function runFocusExternalChecks(): Promise<void> {
  const snapshot = appState.getSnapshot();
  if (!shouldRunAutomaticCheck(snapshot.settings.externalFiles, "focus")) {
    return;
  }

  for (const tab of getActiveSession(snapshot).openTabs) {
    if (!isFileTab(tab)) {
      continue;
    }
    await checkDocumentIfDeferred(tab.documentId, "focus");
  }
  await flushDirtyPrompts();
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
    if (
      documentState?.filePath &&
      normalizePathSync(documentState.filePath) === normalized
    ) {
      await checkDocumentExternalChanges(documentState.id, "watcher");
      await flushDirtyPrompts();
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
  const snapshot = appState.getSnapshot();
  const selectedTab = getActiveSession(snapshot).openTabs.find(
    (tab) => tab.id === getActiveSession(snapshot).selectedTabId,
  );
  if (!selectedTab) {
    return "skipped";
  }

  const selectedDocumentId = tabDocumentId(selectedTab);
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

  const result = await checkDocumentExternalChanges(documentState.id, "manual");
  await flushDirtyPrompts();
  return result;
}
