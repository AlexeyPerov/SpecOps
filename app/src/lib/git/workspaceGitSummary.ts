import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { appState } from "../state/appState";
import { isBackgroundGitAllowedInApp } from "./gitIntegrationGating";
import { invalidateResolveRepoRootCache, resolveRepoRoot } from "./gitRepo";
import { queryRepositoryStatusSummary, type RepositoryStatusSummary } from "./repositoryStatusSummary";
import { subscribeVersionControlMutations } from "./versionControlRefresh";
import { formatGitErrorPrimaryMessage } from "./gitErrorUi";

export type WorkspaceGitSummarySnapshot = {
  status: "unknown" | "loading" | "fresh" | "stale" | "notGit" | "error";
  refreshing: boolean;
  summary: RepositoryStatusSummary | null;
  checkedAt: number | null;
  error: string | null;
};
export type WorkspaceGitSummaryDemand = { priority: "active" | "visible"; enabled?: boolean };
export type WorkspaceGitSummarySubscription = {
  setDemand(demand: WorkspaceGitSummaryDemand): void;
  refresh(): Promise<void>;
  unsubscribe(): void;
};
type Consumer = { path: string; listener: (snapshot: WorkspaceGitSummarySnapshot) => void; demand: WorkspaceGitSummaryDemand };
type Grant = { key: string; rootPath: string; lease: string; revision: number; window: string };
type Payload = { sequence: number; rows: { path: string; snapshot: WorkspaceGitSummarySnapshot }[]; grants: Grant[] };
const UNKNOWN: WorkspaceGitSummarySnapshot = { status: "unknown", refreshing: false, summary: null, checkedAt: null, error: null };
const consumers = new Set<Consumer>();
const snapshots = new Map<string, WorkspaceGitSummarySnapshot>();
const running = new Set<string>();
const seenLeases = new Set<string>();
const refreshWaiters = new Set<() => void>();
let publication = -1;
function cancelRefreshWaiters(): void { for (const cancel of [...refreshWaiters]) cancel(); }
const staleTimers = new Map<string, ReturnType<typeof setTimeout>>();
let windowActive = false;
let startPromise: Promise<void> | null = null;
let syncTail = Promise.resolve();
let syncScheduled = false;
let unlisten: UnlistenFn | null = null;
let unsubscribeState: (() => void) | null = null;
let unsubscribeMutations: (() => void) | null = null;
let disposed = false;
let lifetime = 0;

function publish(path: string, snapshot: WorkspaceGitSummarySnapshot): void {
  snapshots.delete(path); snapshots.set(path, snapshot);
  for (const consumer of consumers) if (consumer.path === path) consumer.listener(snapshot);
  const timer = staleTimers.get(path); if (timer) clearTimeout(timer);
  staleTimers.delete(path);
  if (snapshot.status === "fresh" && snapshot.checkedAt !== null && [...consumers].some(consumer => consumer.path === path)) {
    staleTimers.set(path, setTimeout(() => {
      staleTimers.delete(path);
      const current = snapshots.get(path);
      if (current === snapshot) publish(path, { ...current, status: "stale" });
    }, Math.max(1, snapshot.checkedAt + 60_000 - Date.now())));
  }
  for (const key of snapshots.keys()) {
    if (snapshots.size <= 128) break;
    if (![...consumers].some(consumer => consumer.path === key)) snapshots.delete(key);
  }
}
function accept(payload: Payload): void {
  if (disposed) return;
  if (payload.sequence >= publication) {
    publication = payload.sequence;
    for (const { path, snapshot } of payload.rows) publish(path, snapshot);
  }
  const window = getCurrentWebviewWindow().label;
  for (const grant of payload.grants) {
    if (grant.window !== window || seenLeases.has(grant.lease)) continue;
    seenLeases.add(grant.lease);
    if (seenLeases.size > 256) seenLeases.delete(seenLeases.values().next().value!);
    running.add(grant.lease);
    void readGrant(grant);
  }
}
async function readGrant(grant: Grant): Promise<void> {
  let summary: RepositoryStatusSummary | null = null;
  let error: string | null = null;
  let notGit = false;
  let deferred = false;
  const checkDemand = () => {
    if (!windowActive || !isBackgroundGitAllowedInApp()) { deferred = true; throw new Error("Summary check deferred"); }
  };
  try {
    // No JS abort races: the native lease outlives every awaited runner invocation.
    checkDemand();
    const options = { summaryLease: grant.lease, timeoutMs: 30_000 };
    invalidateResolveRepoRootCache(grant.rootPath);
    const repo = await resolveRepoRoot(grant.rootPath, "background", options);
    checkDemand();
    if (repo.ok) summary = await queryRepositoryStatusSummary(repo.repoRoot, "background", options);
    else notGit = true;
  } catch (cause) { error = formatGitErrorPrimaryMessage(cause); }
  try {
    accept(await invoke<Payload>("workspace_git_summary_complete", {
      lease: grant.lease, revision: grant.revision, summary, error, notGit, ...(deferred ? { deferred: true } : {}),
    }));
  } catch {
    // A destroyed webview's lease is reclaimed natively after its subprocess exits.
  } finally { running.delete(grant.lease); }
}
async function start(): Promise<void> {
  if (startPromise) return startPromise;
  disposed = false;
  const startedLifetime = lifetime;
  startPromise = (async () => {
    const stop = await listen<Payload>("spec-ops/workspace-git-summary", event => { if (startedLifetime === lifetime) accept(event.payload); });
    if (disposed || startedLifetime !== lifetime) { stop(); return; }
    unlisten = stop;
    // Reclaim leases from a previous webview lifetime without abandoning native children.
    await invoke("workspace_git_summary_detach");
    if (disposed || startedLifetime !== lifetime) { stop(); return; }
    let allowed = isBackgroundGitAllowedInApp();
    unsubscribeState = appState.subscribe(() => {
      const next = isBackgroundGitAllowedInApp();
      if (next !== allowed) { allowed = next; scheduleSync(); }
    });
    unsubscribeMutations = subscribeVersionControlMutations(path => invalidateWorkspaceGitSummary(path));
  })().catch(cause => { if (startedLifetime === lifetime) startPromise = null; throw cause; });
  return startPromise;
}
function demands(): { rootPath: string; priority: number }[] {
  if (!isBackgroundGitAllowedInApp()) return [];
  const paths = new Map<string, number>();
  for (const consumer of consumers) {
    if (consumer.demand.enabled === false) continue;
    const priority = consumer.demand.priority === "active" ? 0 : 1;
    paths.set(consumer.path, Math.min(paths.get(consumer.path) ?? 1, priority));
  }
  return [...paths].map(([rootPath, priority]) => ({ rootPath, priority }));
}
function scheduleSync(): void {
  if (!windowActive || !isBackgroundGitAllowedInApp()) cancelRefreshWaiters();
  if (syncScheduled) return;
  syncScheduled = true;
  const scheduledLifetime = lifetime;
  queueMicrotask(() => {
    syncScheduled = false;
    syncTail = syncTail.catch(() => {}).then(async () => {
      if (disposed || scheduledLifetime !== lifetime) return;
      await start();
      if (disposed || scheduledLifetime !== lifetime) return;
      const payload = await invoke<Payload>("workspace_git_summary_sync", { demands: demands(), active: windowActive });
      if (scheduledLifetime === lifetime) accept(payload);
    }).catch(cause => {
      for (const consumer of consumers) publish(consumer.path, { ...getWorkspaceGitSummarySnapshot(consumer.path), status: "error", refreshing: false, error: formatGitErrorPrimaryMessage(cause) });
    });
  });
}
export function getWorkspaceGitSummarySnapshot(path: string): WorkspaceGitSummarySnapshot { return snapshots.get(path) ?? UNKNOWN; }
export function subscribeWorkspaceGitSummary(path: string, listener: Consumer["listener"], demand: WorkspaceGitSummaryDemand = { priority: "visible" }): WorkspaceGitSummarySubscription {
  disposed = false;
  const consumer = { path, listener, demand }; consumers.add(consumer);
  listener(getWorkspaceGitSummarySnapshot(path)); scheduleSync();
  return {
    setDemand(next) { consumer.demand = next; scheduleSync(); },
    refresh: () => refreshWorkspaceGitSummaries([path]),
    unsubscribe() {
      consumers.delete(consumer); scheduleSync();
      if (![...consumers].some(other => other.path === path)) {
        const timer = staleTimers.get(path); if (timer) clearTimeout(timer); staleTimers.delete(path);
      }
    },
  };
}
export function setWorkspaceGitSummaryWindowActive(active: boolean): void {
  if (windowActive === active) return;
  windowActive = active;
  if (!active) cancelRefreshWaiters();
  if (consumers.size || startPromise) scheduleSync();
}
export async function refreshWorkspaceGitSummaries(paths: readonly string[]): Promise<void> {
  if (!paths.length || !windowActive || !isBackgroundGitAllowedInApp()) return;
  await start();
  const subscriptions: WorkspaceGitSummarySubscription[] = [];
  let armed = false;
  let settled = false;
  const pending = new Set(paths);
  let finish!: () => void;
  const finished = new Promise<void>(resolve => {
    finish = () => {
      if (settled) return;
      settled = true; refreshWaiters.delete(finish);
      subscriptions.forEach(subscription => subscription.unsubscribe()); resolve();
    };
  });
  refreshWaiters.add(finish);
  for (const path of pending) subscriptions.push(subscribeWorkspaceGitSummary(path, snapshot => {
    if (!armed || snapshot.refreshing || settled) return;
    pending.delete(path); if (!pending.size) finish();
  }, { priority: "visible" }));
  try {
    await Promise.resolve(); await syncTail;
    if (!windowActive || !isBackgroundGitAllowedInApp() || disposed || settled) { finish(); return; }
    const payload = await invoke<Payload>("workspace_git_summary_refresh", { paths: [...paths] });
    armed = true; accept(payload);
    for (const path of [...pending]) if (!getWorkspaceGitSummarySnapshot(path).refreshing) pending.delete(path);
    if (!pending.size) finish();
    await finished;
  } catch { finish(); }
}
// Watcher bursts (checkout, install, builds) deliver one event per path; batch
// them into one invalidation call instead of an IPC round trip per path.
const INVALIDATE_BATCH_MS = 100;
const pendingInvalidations = new Set<string>();
let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
function flushInvalidations(): void {
  invalidateTimer = null;
  const paths = [...pendingInvalidations]; pendingInvalidations.clear();
  if (!startPromise || !paths.length) return;
  void invoke("workspace_git_summary_invalidate", { paths }).catch(() => {});
}
export function invalidateWorkspaceGitSummary(path: string): void {
  if (!startPromise) return;
  pendingInvalidations.add(path);
  invalidateTimer ??= setTimeout(flushInvalidations, INVALIDATE_BATCH_MS);
}
export function releaseWorkspaceGitSummary(path: string): void {
  if ([...consumers].some(consumer => consumer.path === path)) return;
  snapshots.delete(path);
  if (startPromise) void invoke("workspace_git_summary_release", { path }).catch(() => {});
  const timer = staleTimers.get(path); if (timer) clearTimeout(timer); staleTimers.delete(path);
}
export function disposeWorkspaceGitSummaryService(): void {
  const hadStarted = startPromise !== null;
  lifetime += 1;
  disposed = true; windowActive = false; cancelRefreshWaiters();
  unlisten?.(); unlisten = null; unsubscribeState?.(); unsubscribeState = null; unsubscribeMutations?.(); unsubscribeMutations = null;
  for (const timer of staleTimers.values()) clearTimeout(timer);
  if (invalidateTimer) clearTimeout(invalidateTimer);
  invalidateTimer = null; pendingInvalidations.clear();
  staleTimers.clear(); consumers.clear(); snapshots.clear(); seenLeases.clear(); publication = -1; startPromise = null;
  if (hadStarted) void invoke("workspace_git_summary_detach").catch(() => {});
}
