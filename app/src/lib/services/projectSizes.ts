import { Channel, invoke } from "@tauri-apps/api/core";
import { normalizePathSync } from "./diskFingerprint";

export type ProjectSizeMode = "off" | "files" | "folders";
export interface FolderSizeProgress {
  bytes: number; files: number; entries: number; errors: number;
  done: boolean; reason: "cancelled" | "entryLimit" | "timeLimit" | null;
  calculatedAt: number;
}
export interface ProjectSizeEntry {
  kind: "file" | "directory";
  bytes: number | null;
  loading: boolean;
  stale: boolean;
  calculatedAt: number;
  progress?: FolderSizeProgress;
  error?: string;
}
export interface ProjectSizesDeps {
  files?: (root: string, paths: string[]) => Promise<{ path: string; bytes: number | null }[]>;
  start?: (root: string, path: string, progress: (value: FolderSizeProgress) => void) => Promise<number>;
  cancel?: (id: number) => Promise<unknown>;
  publish: (entries: ReadonlyMap<string, ProjectSizeEntry>) => void;
  notify?: (message: string) => void;
  now?: () => number;
}
const MAX_CACHE = 2048;
const FILE_TTL_MS = 30_000;
const keyOf = (path: string) => normalizePathSync(path).replace(/\/+$/, "");
const within = (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`);

/** Separate metadata state: size-only changes never rebuild the tree. */
export function createProjectSizes(deps: ProjectSizesDeps) {
  const now = deps.now ?? Date.now;
  const readFiles = deps.files ?? ((workspaceRoot, paths) => invoke("project_file_sizes", { workspaceRoot, paths }));
  const start = deps.start ?? (async (workspaceRoot, path, progress) => {
    const onProgress = new Channel<FolderSizeProgress>();
    onProgress.onmessage = progress;
    return invoke<number>("project_start_folder_size", { workspaceRoot, path, onProgress });
  });
  const cancel = deps.cancel ?? ((jobId) => invoke("project_cancel_folder_size", { jobId }));
  let root = "";
  let mode: ProjectSizeMode = "off";
  let active = true;
  let disposed = false;
  let generation = 0;
  let revision = 0;
  let running = false;
  let targets: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingChanges = new Set<string>();
  let changeBatchStartedAt: number | null = null;
  const entries = new Map<string, ProjectSizeEntry>();
  type Job = { id?: number; cancelled: boolean; changed: boolean; generation: number };
  const jobs = new Map<string, Job>();
  function publish() {
    if (entries.size > MAX_CACHE) {
      const visible = new Set(targets.map(keyOf));
      for (const key of entries.keys()) {
        if (entries.size <= MAX_CACHE) break;
        if (!jobs.has(key) && !visible.has(key)) entries.delete(key);
      }
    }
    if (!disposed) deps.publish(new Map(entries));
  }
  function put(key: string, value: ProjectSizeEntry) { entries.delete(key); entries.set(key, value); }
  function cancelJob(key: string) {
    const job = jobs.get(key);
    if (!job) return;
    job.cancelled = true;
    if (job.id !== undefined) void cancel(job.id).catch(() => {});
  }
  function cancelAll() { for (const key of jobs.keys()) cancelJob(key); }
  function schedule(delay = 70) {
    clearTimeout(timer);
    if (!disposed && active && mode !== "off") timer = setTimeout(() => { void pump(); }, delay);
  }
  async function pump() {
    if (running || disposed || !active || mode === "off" || !root) return;
    const needed = targets.filter((path) => {
      const value = entries.get(keyOf(path));
      return !value || value.stale || now() - value.calculatedAt >= FILE_TTL_MS;
    }).slice(0, 128);
    if (!needed.length) return;
    running = true;
    const gen = generation;
    const rev = revision;
    try {
      const result = await readFiles(root, needed);
      if (disposed || generation !== gen || revision !== rev || !active) return;
      const values = new Map(result.map((value) => [keyOf(value.path), value.bytes]));
      for (const path of needed) put(keyOf(path), { kind: "file", bytes: values.get(keyOf(path)) ?? null,
        loading: false, stale: false, calculatedAt: now() });
      publish();
    } catch {
      if (!disposed && generation === gen && revision === rev) {
        for (const path of needed) put(keyOf(path), { kind: "file", bytes: null, loading: false, stale: false, calculatedAt: now(), error: "Size unavailable" });
        publish();
      }
    } finally {
      running = false;
      schedule();
    }
  }
  return {
    configure(workspaceRoot: string, nextMode: ProjectSizeMode, enabled = true) {
      const changedRoot = root !== workspaceRoot;
      const changed = changedRoot || mode !== nextMode || active !== enabled;
      if (!changed) return;
      generation += 1;
      cancelAll();
      for (const [key, value] of [...entries]) {
        put(key, { ...value, stale: true });
        if (value.loading) put(key, { ...value, stale: true, loading: false,
          progress: value.progress ? { ...value.progress, done: true, reason: "cancelled" } :
            { bytes: value.bytes ?? 0, files: 0, entries: 0, errors: 0, done: true, reason: "cancelled", calculatedAt: now() } });
      }
      jobs.clear();
      if (changedRoot) { entries.clear(); targets = []; }
      root = workspaceRoot; mode = nextMode; active = enabled;
      clearTimeout(timer); clearTimeout(changeTimer); pendingChanges.clear(); changeBatchStartedAt = null;
      publish(); schedule();
    },
    visibleFiles(paths: readonly string[]) {
      targets = [...new Set(paths)].filter((path) => within(keyOf(path), keyOf(root))).slice(0, 256);
      // A scroll keeps only the current viewport queued; one batch may already be in flight.
      schedule();
    },
    async calculate(path: string) {
      const key = keyOf(path);
      if (disposed || !active || !within(key, keyOf(root)) || jobs.has(key)) return;
      if ([...jobs.keys()].some((other) => within(key, other) || within(other, key))) {
        deps.notify?.("A calculation for this folder or an overlapping folder is already running."); return;
      }
      if (jobs.size >= 2) { deps.notify?.("Two folder calculations are already running."); return; }
      mode = "folders";
      const job: Job = { cancelled: false, changed: false, generation };
      jobs.set(key, job);
      put(key, { kind: "directory", bytes: 0, loading: true, stale: false, calculatedAt: 0 });
      publish();
      try {
        const id = await start(root, path, (progress) => {
          if (jobs.get(key) !== job) return;
          if (progress.done) jobs.delete(key);
          if (disposed || generation !== job.generation) return;
          put(key, { kind: "directory", bytes: progress.bytes, loading: !progress.done,
            stale: job.changed, calculatedAt: progress.calculatedAt, progress });
          publish();
        });
        job.id = id;
        if (job.cancelled || disposed || generation !== job.generation) await cancel(id);
      } catch (error) {
        if (jobs.get(key) === job) jobs.delete(key);
        if (!disposed && generation === job.generation) {
          put(key, { kind: "directory", bytes: null, loading: false, stale: false, calculatedAt: now(), error: String(error) });
          publish(); deps.notify?.(String(error));
        }
      }
    },
    cancel(path: string) { cancelJob(keyOf(path)); },
    changed(path: string) {
      const key = keyOf(path);
      if (!within(key, keyOf(root)) || (!entries.size && !running && !jobs.size)) return;
      revision += 1;
      // Watcher bursts are reduced to one cache pass and one UI publication.
      if (pendingChanges.size < 256) pendingChanges.add(key);
      else { pendingChanges.clear(); pendingChanges.add(keyOf(root)); }
      for (const [jobKey, job] of jobs) if (within(key, jobKey) || within(jobKey, key)) job.changed = true;
      clearTimeout(changeTimer);
      changeBatchStartedAt ??= now();
      const delay = Math.min(400, Math.max(0, 1000 - (now() - changeBatchStartedAt)));
      changeTimer = setTimeout(() => {
        changeBatchStartedAt = null;
        const changes = [...pendingChanges]; pendingChanges.clear();
        for (const [entryKey, entry] of [...entries]) {
          if (changes.some((changed) => within(entryKey, changed) || (entry.kind === "directory" && within(changed, entryKey)))) put(entryKey, { ...entry, stale: true });
        }
        publish(); schedule();
      }, delay);
    },
    refresh() {
      revision += 1;
      for (const [key, value] of [...entries]) put(key, { ...value, stale: true });
      for (const job of jobs.values()) job.changed = true;
      publish(); schedule();
    },
    dispose() { disposed = true; generation += 1; clearTimeout(timer); clearTimeout(changeTimer); cancelAll(); entries.clear(); },
  };
}

export function formatProjectBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  return `${(bytes / 1024 ** (index + 1)).toFixed(1)} ${units[index]}`;
}
export function projectSizeLabel(entry?: ProjectSizeEntry): string {
  if (!entry || entry.bytes === null) return "—";
  if (entry.loading) return `${formatProjectBytes(entry.bytes)} …`;
  const partial = entry.progress && (entry.progress.reason || entry.progress.errors > 0);
  return `${partial ? "≥ " : ""}${formatProjectBytes(entry.bytes)}${entry.stale ? " *" : ""}`;
}
export function projectSizeTitle(entry?: ProjectSizeEntry, directory = true): string {
  if (!entry) return directory ? "Size not calculated. Use Calculate folder size in the context menu." : "Loading file size…";
  if (entry.error) return entry.error;
  if (entry.bytes === null) return "Size unavailable";
  if (entry.kind === "file") return `${entry.bytes.toLocaleString()} bytes${entry.stale ? " — outdated" : ""}`;
  const details = ["Sum of file sizes, including hidden files and excluded directories. Symbolic links are skipped."];
  if (entry.loading) details.push("Calculating… Cancel from the context menu.");
  if (entry.progress) {
    details.push(`${entry.progress.files.toLocaleString()} files; ${entry.progress.errors.toLocaleString()} unreadable entries.`);
    if (entry.progress.reason) details.push(`Incomplete: ${entry.progress.reason === "cancelled" ? "cancelled" : entry.progress.reason === "timeLimit" ? "30 second limit reached" : "entry limit reached"}.`);
  }
  if (entry.calculatedAt) details.push(`Calculated ${new Date(entry.calculatedAt).toLocaleString()}.`);
  details.push("Snapshot: changes in excluded directories may require recalculation.");
  if (entry.stale) details.push("Outdated: project files changed after calculation started.");
  return details.join("\n");
}
