import type { DiskFingerprint, ExternalFilesSettings } from "../domain/contracts";
import { allTabs, getSessionActiveTab, isFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import {
  allContextSnapshots,
  findDocumentByNormalizedPathAllContexts,
  findDocumentContext,
  getActiveDocuments,
  getActiveSession,
} from "../state/appState/contextHelpers";
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
  /**
   * Paths with an app-initiated save in flight (between the disk write and
   * `recordWriteFingerprint`), refcounted per path. A watcher event that
   * lands in that window must not trigger a reload or a dirty prompt — it is
   * the app's own write echoing back before the fingerprint has been
   * recorded. A refcount (not a Set) so overlapping saves to the same path
   * don't clear the guard while another write is still in flight (H26).
   */
  saveInFlightByPath: new Map<string, number>(),
};

let backgroundStartupChecks: Promise<void> | null = null;
let startupChecksAbort: AbortController | null = null;

/** Clears module-level state between unit tests. */
export function resetExternalFileChangesForTests(): void {
  runtimeState.lastWriteFingerprintByPath.clear();
  runtimeState.dialogOpenForDocument.clear();
  deferredDirtyDocumentIds.clear();
  runtimeState.inFlightCheckByDocument.clear();
  runtimeState.pendingDirtyPromptByDocument.clear();
  runtimeState.flushingDirtyPrompts = false;
  runtimeState.saveInFlightByPath.clear();
  backgroundStartupChecks = null;
  startupChecksAbort = null;
}

/**
 * Drop all external-change bookkeeping for a document that has just been closed.
 * Without this, `deferredDirtyDocumentIds` and the in-flight/pending maps retain
 * entries for closed documents for the rest of the session (L20).
 */
export function clearDocumentExternalChangeState(
  documentId: string,
  filePath?: string | null,
): void {
  deferredDirtyDocumentIds.delete(documentId);
  runtimeState.inFlightCheckByDocument.delete(documentId);
  runtimeState.pendingDirtyPromptByDocument.delete(documentId);
  runtimeState.dialogOpenForDocument.delete(documentId);
  if (filePath) {
    clearWriteFingerprintForPath(filePath);
  }
}

/** Mark `path` as having a save in flight (called before the disk write). */
export function beginSaveInFlight(path: string): void {
  const key = normalizePathSync(path);
  runtimeState.saveInFlightByPath.set(
    key,
    (runtimeState.saveInFlightByPath.get(key) ?? 0) + 1,
  );
}

/** Release one in-flight marker once the write fingerprint is recorded. */
export function clearSaveInFlight(path: string): void {
  const key = normalizePathSync(path);
  const count = runtimeState.saveInFlightByPath.get(key) ?? 0;
  if (count <= 1) {
    runtimeState.saveInFlightByPath.delete(key);
    return;
  }
  runtimeState.saveInFlightByPath.set(key, count - 1);
}

/**
 * Cancel any in-flight background startup external checks. Called from the app
 * shell teardown so a closing window does not keep stat-ing files and racing
 * with the store being torn down.
 *
 * Returns a promise that settles when the background drain observes the abort
 * (or immediately if none is running).
 */
export function cancelStartupExternalChecks(): Promise<void> {
  startupChecksAbort?.abort();
  startupChecksAbort = null;
  const pending = backgroundStartupChecks;
  backgroundStartupChecks = null;
  return pending ?? Promise.resolve();
}

function assertNotAborted(signal: AbortSignal | null): void {
  if (signal?.aborted) {
    throw new DOMException("Startup external checks cancelled", "AbortError");
  }
}

/** Await deferred startup external checks (tests / diagnostics). */
export function awaitStartupExternalChecksBackgroundForTests(): Promise<void> {
  return backgroundStartupChecks ?? Promise.resolve();
}

export function shouldSyncFileWatcher(settings: ExternalFilesSettings): boolean {
  return settings.watchExternalChanges;
}

export { shouldRunAutomaticCheck } from "./externalFileReloadPolicy";

/**
 * Upper bound on the self-write fingerprint cache. Each entry is one path's last
 * write fingerprint; the map is never evicted on tab close, so without a cap a
 * long session that saves many distinct files would grow it without limit. Map
 * preserves insertion order, so the oldest entry is dropped when the cap is hit.
 */
const MAX_WRITE_FINGERPRINT_ENTRIES = 256;

export function recordWriteFingerprint(path: string, fingerprint: DiskFingerprint): void {
  const key = normalizePathSync(path);
  runtimeState.lastWriteFingerprintByPath.delete(key);
  runtimeState.lastWriteFingerprintByPath.set(key, fingerprint);
  if (runtimeState.lastWriteFingerprintByPath.size > MAX_WRITE_FINGERPRINT_ENTRIES) {
    const oldest = runtimeState.lastWriteFingerprintByPath.keys().next().value;
    if (oldest !== undefined) {
      runtimeState.lastWriteFingerprintByPath.delete(oldest);
    }
  }
}

/**
 * Drop the self-write fingerprint for a path. Called when a document closes so
 * the entry does not linger for the session after its tab is gone (the path may
 * be re-opened or watched by an external editor, where a stale self-write guard
 * would wrongly suppress a reload).
 */
export function clearWriteFingerprintForPath(path: string): void {
  runtimeState.lastWriteFingerprintByPath.delete(normalizePathSync(path));
}

export async function recordWriteFingerprintFromPath(path: string): Promise<DiskFingerprint> {
  const fingerprint = await statDiskFingerprint(path);
  recordWriteFingerprint(path, fingerprint);
  return fingerprint;
}

export async function initializeDocumentDiskState(
  documentId: string,
  filePath: string,
  fingerprint?: DiskFingerprint,
): Promise<void> {
  // Resolve the owning context before the await: `setDocumentDiskState` targets
  // the active context, so a context switch during the stat would drop the patch
  // and leave `diskFingerprint: null` → a spurious external-change prompt on the
  // next check. `setDocumentDiskStateForContext` lands the patch in the right
  // workspace regardless of what is active when the await resolves.
  const owner = findDocumentContext(appState.getSnapshot(), documentId);
  try {
    const resolved = fingerprint ?? (await statDiskFingerprint(filePath));
    if (owner) {
      appState.setDocumentDiskStateForContext(owner.contextId, documentId, {
        diskFingerprint: resolved,
        fileMissing: false,
      });
    } else {
      appState.setDocumentDiskState(documentId, {
        diskFingerprint: resolved,
        fileMissing: false,
      });
    }
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      if (owner) {
        appState.setDocumentDiskStateForContext(owner.contextId, documentId, {
          diskFingerprint: null,
          fileMissing: true,
        });
      } else {
        appState.setDocumentDiskState(documentId, {
          diskFingerprint: null,
          fileMissing: true,
        });
      }
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
 * Scans every context (notepad + chat-http + all workspaces) so files that
 * belong to a non-active workspace are checked too. The background drain can
 * be cancelled via {@link cancelStartupExternalChecks} (app shell teardown).
 */
export async function runStartupExternalChecks(): Promise<void> {
  const snapshot = appState.getSnapshot();
  if (!shouldRunAutomaticCheck(snapshot.settings.externalFiles, "startup")) {
    return;
  }

  const session = getActiveSession(snapshot);
  const fileDocumentIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of allContextSnapshots(snapshot)) {
    for (const tab of allTabs(entry.snapshot.session.editorLayout)) {
      if (isFileTab(tab) && !seen.has(tab.documentId)) {
        seen.add(tab.documentId);
        fileDocumentIds.push(tab.documentId);
      }
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
  // Fresh controller per scan; cancelStartupExternalChecks aborts it.
  startupChecksAbort = new AbortController();
  const signal = startupChecksAbort.signal;
  backgroundStartupChecks = (async () => {
    try {
      for (let offset = 0; offset < deferredIds.length; offset += STARTUP_EXTERNAL_CHECK_BATCH_SIZE) {
        assertNotAborted(signal);
        const batch = deferredIds.slice(offset, offset + STARTUP_EXTERNAL_CHECK_BATCH_SIZE);
        await mapWithConcurrency(batch, STARTUP_EXTERNAL_CHECK_CONCURRENCY, async (documentId) => {
          // Skip ids pruned since the scan started (tab closed / context gone).
          if (!findDocumentContext(appState.getSnapshot(), documentId)) {
            return;
          }
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
      const aborted = error instanceof DOMException && error.name === "AbortError";
      await logPerfTiming(
        aborted ? "startup external checks background cancelled" : "startup external checks background failed",
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
  const seen = new Set<string>();
  for (const entry of allContextSnapshots(snapshot)) {
    for (const tab of allTabs(entry.snapshot.session.editorLayout)) {
      if (isFileTab(tab) && !seen.has(tab.documentId)) {
        seen.add(tab.documentId);
        await checkDocumentIfDeferred(tab.documentId, "focus");
      }
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
  // Resolve the owning context for the watched path so a background-workspace
  // document is reloaded/marked even when its workspace is not the active
  // context. The check itself applies disk state via the context-aware API.
  const match = findDocumentByNormalizedPathAllContexts(snapshot, normalized);
  if (match) {
    await checkDocumentExternalChanges(match.documentId, "watcher");
    await flushDirtyPrompts(runtimeState, deferredDirtyDocumentIds);
  }
}

export function collectOpenFilePaths(): string[] {
  const snapshot = appState.getSnapshot();
  const paths = new Set<string>();
  for (const tab of allTabs(getActiveSession(snapshot).editorLayout)) {
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
