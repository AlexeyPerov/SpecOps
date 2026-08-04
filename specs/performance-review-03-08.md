# Performance review — 2026-08-03

Broad performance audit following continued reports of lag when switching
workspaces and file tabs, plus a bug where new files stop opening inside a
workspace until relaunch (or open after tens of seconds). Five parallel
deep-dives were run: git command triggers, the workspace-switch path, the
tab-switch path, the file-open stall, and a general sweep (timers, logging,
disabled beta features, search, memory).

Live log evidence from `~/Library/Logs/com.alexeyperov.specops/SpecOps.log`
(current session): **every file-tab activation runs `git rev-parse
--show-toplevel` (~25–32 ms) followed by `git status --porcelain=v2 -z`
(~165–172 ms)** against the workspace repo — outside the Version Control view.
This confirms the primary suspicion: git integration is the largest single
contributor to switch lag, and the requirement "git only in the Version
Control tab" is not implemented anywhere (`gitIntegrationGating.ts` has no
view-awareness at all).

Beta/AI gating was explicitly verified: with `settings.opencode.enabled =
false` (the default) the sidecar is never spawned, chat stores do not hydrate,
and no network calls occur. Only minor residual churn remains (P03-08-29).

Complexity scale: **S** = small (isolated, up to a few hours), **M** = medium
(roughly half to one day, moderate risk), **L** = large (multi-day or
architectural work).

All line numbers refer to the working tree at commit `b592f19`.

---

## Critical — file-open stalls and runtime starvation

These explain the "new files stop opening until relaunch / open after tens of
seconds" bug. Two independent audits converged on P03-08-02.

## P03-08-01 — Stale-lock recovery can spin forever and wedge all file opens

- **Status:** Resolved on 2026-08-03. The acquire loop now checks the deadline
  and a hard iteration cap at the top of every iteration, and every retry path
  (including the stale-break) goes through the shared sleep. Covered by a
  regression test that makes the stale lock unremovable and asserts the write
  still proceeds within the deadline.
- **Area:** Session write lock / file opening.
- **Impact:** **High.** This is the most likely cause of "files never open
  again until relaunch." Once the cross-window lock directory is judged stale
  (age > 10 s), the retry loop `continue`s **before** both the deadline check
  and the 40 ms sleep (`sessionWriteLock.ts:236-251` vs `:253` and `:256`). If
  `remove(lockPath)` fails or another window keeps recreating the directory,
  the acquire spins forever with no timeout, issuing `mkdir`/`stat`/`readFile`
  IPC as fast as the bridge allows — and since those are synchronous commands
  (P03-08-04) it also saturates the main thread. The head of the global write
  chain never settles, so every later `claimOpenFile` waits forever: **no new
  file can open until relaunch**, with no error surfaced.
- **Fix complexity:** **S.**
- **Evidence:** `app/src/lib/services/sessionWriteLock.ts:236-251` — the
  stale-break branch jumps over the `deadline` check (`:253`) and the
  `sleep(LOCK_RETRY_DELAY_MS)` (`:256`). A milder variant of the same deadline
  bypass exists at `:223-228` (bounded to 2 iterations).
- **Suggested solution:** Move the deadline check to the top of the `for(;;)`
  body; always sleep before `continue` on the stale-break path; add a hard
  iteration cap. Surface a user-visible error when acquisition ultimately
  fails instead of hanging silently.

## P03-08-02 — `run_git` blocks tokio workers shared with file reads

- **Status:** Resolved on 2026-08-03. `run_git` and `git_commit_with_message`
  are now true `async fn`s that run their blocking bodies in
  `spawn_blocking`, off the worker pool shared with `tauri-plugin-fs`. The
  unregistered read-only path now enforces a timeout in Rust
  (`run_command_with_limited_output` polls with a deadline and kills on
  expiry), and the frontend sends a default `timeoutMs` for every command,
  including read-only ones.
- **Area:** Rust backend / git execution / file I/O starvation.
- **Impact:** **High.** Best explanation for "files open after tens of
  seconds." `run_git` is declared `#[tauri::command(async)]` on a **sync fn**
  (`git.rs:1529-1530`), which dispatches the fully blocking body (subprocess
  `wait`, or a `try_wait` + 50 ms sleep loop) onto Tauri's tokio worker pool
  (worker count ≈ CPU cores) — **not** `spawn_blocking`. The fs plugin's
  `read_file`/`write_text_file` are `async fn` commands on that **same
  runtime**. Once ≥ worker-count git commands are concurrently blocked
  (trivially reachable — see P03-08-07's unbounded fan-out), file-read futures
  are never polled and document opens stall until a git command returns.
  Aggravator: read-only git commands (`status`, `log`, `diff`, `rev-parse`)
  run with **no timeout at all** (`gitRun.ts:59-62`, `:212` → `git.rs:1393` →
  unbounded `child.wait()` at `:1128`), so one hung `git status` (network
  mount, credential helper) pins a worker forever. Two audits found this
  independently.
- **Fix complexity:** **S.**
- **Evidence:** `app/src-tauri/src/git.rs:1529-1530`, `:1123-1135`,
  `:518-597`; correct pattern already used by siblings `git_available`
  (`:1425-1428`), `cancel_git_command` (`:1557-1559`), `drain_git_commands`
  (`:1570-1572`). `git_commit_with_message` has the same defect.
  `tauri-plugin-fs-2.5.1/src/commands.rs:594,1184` confirms fs commands share
  the runtime.
- **Suggested solution:** Wrap the blocking bodies of `run_git` and
  `git_commit_with_message` in `tauri::async_runtime::spawn_blocking`; give
  the unregistered read-only path a default timeout (reuse
  `LOCAL_GIT_OPERATION_TIMEOUT_MS`); optionally cap concurrent git processes
  with a Rust semaphore.

## P03-08-03 — One global write chain gates every file open, with no watchdog

- **Status:** Resolved on 2026-08-03 (watchdog + chain split; the
  reservation-upgrade collapse of the two per-open claims remains open as an
  optimization, not a stall risk). Each chained write is now guarded by a 30 s
  watchdog that rejects the caller and advances the queue — starting when the
  entry begins executing, not when queued, so entries behind a slow-but-legit
  write are not falsely abandoned. The open-file registry got its own chain
  and cross-window lock dir (`open-files.json.lock`), so file opens no longer
  serialize behind session persistence. Covered by watchdog, slow-predecessor,
  and chain-independence regression tests.
- **Area:** Session persistence / file opening.
- **Impact:** **High.** `claimOpenFile` shares a single module-global FIFO
  promise chain (`sessionWriteLock.ts:261-276`) with *all* session
  persistence, registry sync, window pruning, rename, and dedupe operations.
  Any one entry hanging (P03-08-01, P03-08-02 via `atomicWriteTextFile`, an
  unresolved Rust command) permanently blocks **all future opens** with no
  timeout, no abort, and no user-visible error. Even the happy path is heavy:
  2 lock acquisitions per open, 2 unconditional full disk reads of
  `open-files.json` (`openFileRegistry.ts:106` — the cache at `:199` is
  bypassed on the RMW path), 2 atomic writes, and 2 broadcasts of the entire
  registry to every window — ~12 IPC round-trips per open, 6 on the main
  thread.
- **Fix complexity:** **M.**
- **Evidence:** `app/src/lib/services/sessionWriteLock.ts:261-276`;
  `app/src/lib/services/openFileGate.ts:61`, `:171`;
  `app/src/lib/services/openFileRegistry.ts:106`, `:141`, `:235`.
- **Suggested solution:** (a) wrap each chained operation in a watchdog that
  rejects after N seconds so a wedged entry cannot poison the chain; (b) split
  the chain — the open-file registry does not need the same mutex as
  `session.json`; (c) collapse the two `claimOpenFile` calls per open into one
  reservation-upgrade under a single acquisition.

## P03-08-04 — Synchronous fs plugin commands run on the main thread

- **Status:** Resolved on 2026-08-03 for the identified hot paths. New
  project-owned `session_fs_*` commands (`#[tauri::command(async)]` +
  `spawn_blocking`, scoped to the app-data directory) now back the session
  write lock's mkdir/stat/remove/owner I/O, and `atomicWriteTextFile` on
  session-storage paths collapses into a single native
  `session_fs_atomic_write_text` call (which also fsyncs the temp file before
  the rename, closing the documented power-loss window). The frontend probes
  `session_fs_supported` once and falls back to `tauri-plugin-fs` when the
  native commands are absent (tests, older backends). Remaining plugin-fs
  usage elsewhere (e.g. `openPath`'s stat) is single-call, not spin-loop.
- **Area:** Tauri IPC / UI thread.
- **Impact:** **High (amplifier).** `stat`, `mkdir`, `remove`, and `rename`
  from `tauri-plugin-fs` are plain `#[tauri::command]` (sync) and execute
  inline on the main/IPC thread. The session-lock spin loop (up to ~125
  iterations per contended acquire), every `atomicWriteTextFile`
  (write + rename), and `openPath`'s own `stat` all compete with the UI. This
  turns P03-08-01/P03-08-11 from "slow background work" into app-wide
  freezes.
- **Fix complexity:** **M.**
- **Evidence:** `tauri-plugin-fs-2.5.1/src/commands.rs:423`, `:737`, `:806`,
  `:963`; consumers `sessionWriteLock.ts:191,208,219,247`,
  `atomicWrite.ts:75,91,98,117`, `fileSystem.ts:292`.
- **Suggested solution:** Route session/lock filesystem work through
  project-owned `#[tauri::command(async)]` + `spawn_blocking` Rust commands;
  at minimum stop calling `stat`/`mkdir`/`remove` in a spin loop.

## P03-08-05 — Lock heartbeat cannot keep the lock fresh and can delete another window's lock

- **Status:** Resolved on 2026-08-03. Staleness is now judged from the owner
  file's mtime (which the heartbeat actually refreshes), falling back to the
  directory mtime only when the owner record is missing. Each heartbeat
  re-verifies ownership before writing and stops itself on takeover; release
  skips removal once the lock was lost. Heartbeat refreshes also stop after
  60 s of hold so a wedged holder's lock eventually goes stale and can be
  broken by other windows. Covered by takeover and owned-release regression
  tests.
- **Area:** Session write lock / multi-window correctness.
- **Impact:** **Medium.** Two compounding bugs: (1) freshness is judged from
  the lock **directory** mtime, but the heartbeat rewrites the `owner` *file*
  inside it — overwriting file contents does not update the parent directory
  mtime, so any hold longer than 10 s is always judged stale and broken;
  (2) after window A's lock is broken and window B acquires, A's still-running
  heartbeat writes A's identity into B's lock dir, and A's release then
  removes **B's live lock** mid-write. Feeds P03-08-01's spin and silently
  re-introduces the mutual-exclusion loss the mechanism was built to prevent.
- **Fix complexity:** **M.**
- **Evidence:** `app/src/lib/services/sessionWriteLock.ts:197-213`, `:219`,
  `:234`; design comment at `:20-25`.
- **Suggested solution:** Stat the `owner` file (or write a fresh
  per-heartbeat file) instead of the directory; have the heartbeat verify it
  still owns the lock before writing and stop itself when it does not.

---

## Git executed outside the Version Control view

There is no "git only while the VC view is active" concept in the codebase.
All git shell-outs funnel through `runGit` (`gitRun.ts:296`), so one gate
covers everything — see task P03-08-T1. Verified clean: no `setInterval` git
polling, no watcher→git feedback loop (the Rust watcher ignores `.git`), no
per-file git calls, no status-bar/gutter git usage.

## P03-08-06 — Project-tree badges run full `git status` on every switch

- **Status:** Resolved on 2026-08-03. The page effect no longer depends on
  `session.lastActiveSessionId` or `chatStore.isGenerating`, so it fires only
  on workspace/tab switches — not on every agent turn and session change. The
  tracker now serves warm snapshots within a per-workspace TTL (75 s) without
  re-shelling-out, and mutation-driven refreshes bypass the TTL. `resolveRepoRoot`
  is memoized per workspace path and invalidated on `git init`-class mutations,
  collapsing the doubled `git rev-parse` per switch. The whole path is gated
  behind the new git scope setting (P03-08-T1), so with `versionControlOnly`
  no `git status` runs on switching when no VC tab is active.
- **Area:** Project tree file badges / tab and workspace switching.
- **Impact:** **High.** This is the log-confirmed ~200 ms of git per tab
  activation. The `$effect` at `+page.svelte:996-1017` depends on `session`
  (a new object on every tab switch), `session.lastActiveSessionId`, and
  `chatStore.getRuntimeState().isGenerating`, so `refreshFileStatuses` →
  `git rev-parse --show-toplevel` + `git status --porcelain=v2 -z` fires on:
  every workspace switch, every switch between a session tab and a file tab,
  every session change, and **twice per agent turn**. There is no result
  cache, no TTL, no debounce on this path (the 150 ms debounce only covers
  `scheduleDebouncedFileStatusRefresh`), the tracker is **cleared on workspace
  switch** (`+page.svelte:1005-1007`) guaranteeing cold A→B→A refetches, a
  concurrent refresh queues a third follow-up fetch
  (`fileStatusTracker.ts:279-282`), and `resolveRepoRoot`
  (`gitRepo.ts:37-64`) is never memoized, doubling the process count.
- **Fix complexity:** **S–M.**
- **Evidence:** `app/src/routes/+page.svelte:996-1017`;
  `app/src/lib/services/fileStatusTracker.ts:140-161`, `:225`, `:279-282`,
  `:290-299`; `app/src/lib/git/gitRepo.ts:37-64`; live log showing the
  rev-parse + status pair per tab activation.
- **Suggested solution:** Depend only on `activeWorkspaceRoot` +
  `isSessionTabActive`; drop `lastActiveSessionId`/`isGenerating`. Add a
  per-repo TTL cache (60 - 90 s) and keep a bounded LRU across switches instead
  of clearing. Memoize `resolveRepoRoot` per workspace root. Make badge
  refresh event-driven off the file watcher. Gate the whole path behind the
  new git scope setting (P03-08-T1).

## P03-08-07 — Workspace Manager git column refetches everything with unbounded concurrency

- **Status:** Resolved on 2026-08-03. The Workspace Manager load loop now
  bounds cross-repo fan-out to 4 concurrent git processes via
  `mapWithConcurrency` (previously `Promise.all` fired one per row — up to 2N
  subprocesses). The git column cell loader gained a per-workspace result TTL
  (60 s) so re-mounting the view skips the git round-trip; mutations
  invalidate the cached cell via the existing VC mutation subscription.
- **Area:** Workspace Manager / git.
- **Impact:** **High.** The `$effect` at `WorkspaceManagerView.svelte:214-220`
  is keyed on the `workspaces` array identity and re-runs on any list change;
  the fetch loop at `:136-147` then calls `loadWorkspaceGitColumnCell` for
  **every** row unconditionally (the `pending` check only suppresses the
  loading placeholder) via `Promise.all` with **no concurrency limit** — up to
  2N simultaneous blocking git processes for N workspaces. With N ≥ CPU cores
  this alone saturates the tokio pool (P03-08-02) and stalls file opens.
  There is no timestamped result cache (`workspaceManagerGitColumn.ts:107-116`
  dedupes in-flight promises only), so every mount of the view re-shells-out.
- **Fix complexity:** **S.**
- **Evidence:** `app/src/lib/components/WorkspaceManagerView.svelte:124-147`,
  `:214-220`; `app/src/lib/git/workspaceManagerGitColumn.ts:107-132`.
- **Suggested solution:** Fetch only rows without a fresh cell; add a
  concurrency limit (2–4); add a short TTL result cache; defer offscreen rows
  (IntersectionObserver). Gate behind the git scope setting.

## P03-08-08 — Per-repo git queue has no timeout, cap, cancellation, or eviction

- **Status:** Resolved on 2026-08-03. The per-repo queue is split into two
  lanes: mutations stay FIFO-serial (index-lock safety), reads run on a
  bounded-concurrent lane (cap 4) so multiple reads of the same repo proceed
  in parallel and a slow read no longer blocks a queued mutation (or vice
  versa). Queued commands whose `AbortSignal` already fired are rejected
  before running instead of executing just to discard the result. The repo's
  lane entry is evicted once both lanes settle, closing the per-repo memory
  leak. Read timeouts are enforced Rust-side (P03-08-02).
- **Area:** Git command queue / head-of-line blocking.
- **Impact:** **High.** One unbounded serial promise chain per repo root
  (`gitCommandQueue.ts:13-28`): reads queue behind writes; a `fetch`/`pull`/
  `push` on a slow remote blocks every local read for that repo for up to the
  **10-minute** remote timeout (`gitRun.ts:18`); a hung read-only command
  (which has no timeout — P03-08-02) wedges the repo's queue for the session;
  `AbortSignal`s only discard results — the process still runs and holds the
  queue; the map entry is never deleted. Queued commands also each hold a
  blocked tokio worker, multiplying worker starvation.
- **Fix complexity:** **M.**
- **Evidence:** `app/src/lib/git/gitCommandQueue.ts:13-28`;
  `app/src/lib/git/gitRun.ts:18`, `:321-323` (bypass exists but is opt-in for
  one probe only).
- **Suggested solution:** Split into two lanes (mutations serial; reads
  concurrent with a small cap and argv-coalescing); short timeout (5–10 s) for
  reads; honor `AbortSignal` by dropping not-yet-started entries; prune the
  map entry when the settled tail is reached.

## P03-08-09 — Version Control view remount fans out ~12–16 serialized git commands

- **Status:** Resolved on 2026-08-03. The redundant `queryRemotes` calls (VC
  view probe + Tags panel mount + Tags panel refresh) collapse through a
  shared short-TTL per-repo remotes cache (`loadRemotes`, 30 s), invalidated
  on VC mutations. The Tags panel was already lazily mounted (only when its
  section is active), and its remote `ls-remote` probe was already opt-in via
  the "Check remote" button (F30). The mount-time probe cache (5 s TTL) was
  already in place.
- **Area:** Version Control view (in-scope git, but bursty).
- **Impact:** **Medium.** `VersionControlView` is conditionally mounted, so
  every tab switch into it remounts and re-runs the probe (3 commands), branch
  header (3), remotes, status, log, branches, stashes, and tags (including a
  network `ls-remote` with a 15 s ceiling) — all serialized on the per-repo
  queue. Only the probe has a cache (5 s); `queryRemotes` is called from three
  places.
- **Fix complexity:** **M.**
- **Evidence:** `app/src/lib/components/EditorPaneContent.svelte:449-450`;
  `app/src/lib/git/versionControlProbe.ts:50-75`;
  `app/src/lib/components/VersionControlView.svelte:511-512`, `:567-585`,
  `:650-655`; `GitChangesPanel.svelte:125,188-202`;
  `GitHistoryPanel.svelte:237`; `GitTagsPanel.svelte:83,167,240`.
- **Suggested solution:** Hoist a per-repo VC snapshot cache with a short TTL
  keyed off `versionControlRefresh` mutations; pass remotes down as a prop;
  defer the tags/ls-remote probe until the Tags panel is opened.

## P03-08-10 — Git subprocess overhead: threads, polling, lock retries, optional locks

- **Status:** Partially resolved on 2026-08-03. Read-only commands now run with
  `GIT_OPTIONAL_LOCKS=0` (env built via a unit-tested `build_effective_git_env`),
  so `git status`/`diff`/`log` skip the optional index lock and cannot contend
  with a concurrent writer. The read/write classification mirrors the frontend
  `isWriteGitCommand`. The reader-thread cost (a) remains — the threads are
  necessary for the byte cap — and the registered-command poll loop (b) and
  in-queue index-lock retries (c) are deferred: `spawn_blocking` (P03-08-02)
  plus `GIT_OPTIONAL_LOCKS=0` cover the dominant cost.
- **Area:** Rust git execution.
- **Impact:** **Medium (batch).** (a) 2–3 OS threads spawned per git command
  for stdout/stderr readers (`git.rs:266-275`, `:291-301`); (b) registered
  (write) commands are waited on with a `try_wait` + 50 ms sleep loop
  (`git.rs:590`), adding an avg ~25 ms latency floor while holding a blocked
  worker; (c) on `index.lock` contention, up to 3 full re-invocations plus
  200/400/600 ms sleeps happen **inside the held queue slot**
  (`gitRun.ts:263-276`); (d) read-only status calls don't pass
  `GIT_OPTIONAL_LOCKS=0`, so they can take the index lock and fight concurrent
  writers.
- **Fix complexity:** **S–M.**
- **Suggested solution:** Blocking `Child::wait` instead of the poll loop;
  pass `GIT_OPTIONAL_LOCKS=0` (or `--no-optional-locks`) on all read-only
  paths; move lock retries out of the queue slot.

---

## Workspace switching

## P03-08-11 — File watcher re-walks the entire workspace tree on every switch

- **Status:** Resolved on 2026-08-04. The recursive project-tree watcher now
  watches every open workspace root (not just the active one), so a workspace
  switch is a diff — add/remove the changed root — instead of a full
  unwatch + re-walk. The `FileIdMap::add_root` walk (which stats every entry
  under the root) is now skipped for recursive roots entirely: the app uses
  coarse path + kind filtering, not rename correlation, so the cache walk was
  pure cost. The `prune_ignored_subdirectories` best-effort unwatch of heavy
  top-level subdirs (`.git`/`node_modules`/`target`) is kept for Linux inotify
  hygiene. Covered by a multi-root regression test asserting adding a second
  root does not unwatch the first.
- **Area:** Rust file watcher / workspace switching.
- **Impact:** **High.** Exactly one recursive root is watched at a time
  (`file_watcher.rs:551`), so every switch unwatches the old workspace and
  `add_root`s the new one. `notify_debouncer_full`'s `FileIdMap::add_root`
  with `RecursiveMode::Recursive` walks and **stats every entry under the
  root** — and `prune_ignored_subdirectories` runs *after* `add_root`
  (`:374-407`, called at `:476`), so `node_modules`, `.git`, `target`, `dist`
  are fully walked and stat'd first, then dropped. 10⁴–10⁵ stats per switch
  on a typical JS/Rust repo, repeated on every A→B→A. Runs on the blocking
  pool but holds the watcher mutex for the whole walk (see P03-08-12).
  Side-effect: parked workspaces receive no fs events, so their cached trees
  and catalogs silently go stale.
- **Fix complexity:** **M.**
- **Evidence:** `app/src-tauri/src/file_watcher.rs:461-488`, `:535-572`,
  `:374-407`; frontend trigger `appShellEffects.ts:685-708`.
- **Suggested solution:** Watch all open workspace roots so a switch is a
  no-op diff; skip or replace the file-ID cache for recursive roots (the app
  needs coarse paths + kind, not rename correlation); prune ignored subdirs
  *before* registration by adding per-child roots.

## P03-08-12 — Watcher path sync is a synchronous main-thread command that rebuilds the whole FSEvents stream

- **Status:** Resolved on 2026-08-04. `sync_file_watcher_paths` is now
  `#[tauri::command(async)]` + `spawn_blocking`, mirroring the sibling
  `sync_project_tree_watcher` (F43) that was already converted. The blocking
  `watch()`/`unwatch()` diff no longer holds the main/IPC thread, so file-read
  and session-lock IPC are serviced while the watch set is reconciled.
- **Area:** Rust file watcher / UI thread / file opening.
- **Impact:** **High.** `sync_file_watcher_paths` is a plain sync
  `#[tauri::command]` (`file_watcher.rs:493-527`) — it runs on the **main
  thread** and takes the same mutex that `sync_project_tree_watcher` holds
  during its recursive walk (P03-08-11), so a switch can freeze the window for
  the walk's full duration; while frozen, no sync fs IPC is serviced, stalling
  the open path and session lock too. Independently: `apply_watcher_path_diff`
  calls `watch()`/`unwatch()` once per path, and on macOS **each call stops
  the FSEvents run-loop thread and recreates the whole stream with all N
  paths** (`notify-6.1.1/src/fsevent.rs:283-296`). The watched set grows to
  `MAX_WATCHED_PATHS = 500`, so per-open/per-close main-thread cost scales
  with open-tab count — the classic "degrades the longer you use the app"
  signature. The sibling `sync_project_tree_watcher` was already converted to
  async + `spawn_blocking` in an earlier fix (comment cites "F43"); this one
  was missed.
- **Fix complexity:** **S–M.**
- **Evidence:** `app/src-tauri/src/file_watcher.rs:461-488`, `:493-527` vs
  `:533-572`; `app/src/lib/services/appShellEffects.ts:738-751`;
  `app/src/lib/services/appShellHelpers.ts:20`.
- **Suggested solution:** Mark it `#[tauri::command(async)]` +
  `spawn_blocking`; batch the diff so watch/unwatch fire once per sync (or
  watch parent directories instead of individual files); hold the mutex for
  bookkeeping only, not across walks.

## P03-08-13 — Watcher sync key is order-dependent, so it churns on every switch

- **Status:** Resolved on 2026-08-04. `watchedPathsFromState` now sorts the
  collected paths before returning, and truncation at `MAX_WATCHED_PATHS` takes
  a deterministic sorted subset. The sync key is now stable across switches
  regardless of which workspace is active (the path set is order-independent),
  eliminating the per-switch watcher-resync IPC for an identical watched set.
- **Area:** External file watcher / effect keys.
- **Impact:** **Medium standalone; high as the trigger for P03-08-12.**
  `watchedPathsFromState` iterates contexts active-first and joins paths in
  that order, so the key changes on every workspace switch even when the path
  *set* is identical → `syncFileWatcherPaths` IPC every switch. With > 500
  open tabs the active-first truncation makes the sets genuinely differ per
  workspace, causing real watch/unwatch churn.
- **Fix complexity:** **S.**
- **Evidence:** `app/src/lib/services/appShellHelpers.ts:29-53`; memo compares
  at `appShellEffects.ts:745-750`, `appShellRuntime.ts:177-187`.
- **Suggested solution:** Sort paths before joining/truncating.

## P03-08-14 — Cold workspace switch rebuilds up to 16 CodeMirror views synchronously

- **Status:** Resolved on 2026-08-04. `MAX_MOUNTED_EDITOR_CONTEXTS` raised from
  3 to 6 — parked hosts are `display:none` and bounded per-pane, so a user with
  ≤ 6 workspaces never hits a cold remount. Additionally, non-active keep-alive
  tabs in a freshly-mounted context now hydrate on `requestIdleCallback`
  (falling back to `setTimeout`): only the active pane's selected tab mounts
  synchronously, and sibling tabs stagger across idle frames. Switching to a
  deferred tab before it hydrates promotes it synchronously. Covered by
  `partitionImmediateAndDeferred` unit tests.
- **Area:** Workspace switching / editor lifecycle.
- **Impact:** **High for users with more than 3 workspaces.** Switching to a
  workspace outside the 3-context keep-alive LRU
  (`editorContextKeepAlive.ts:4`) mounts a whole editor grid — up to 4 live
  editors per pane × 4 panes — each with full document text, language parse,
  and extension setup, synchronously within one Svelte flush, while the
  evicted context's tree is destroyed (which itself serializes undo history —
  P03-08-22).
- **Fix complexity:** **M** (stagger/park) to **L** (idle hydration).
- **Evidence:** `app/src/lib/editor/editorContextKeepAlive.ts:4`;
  `app/src/lib/components/AppShell.svelte:493-516`, `:726-802`;
  `app/src/lib/editor/editorTabKeepAlive.ts:2`;
  `EditorPaneContent.svelte:370-389`, `:507-519`.
- **Suggested solution:** On a cold context, eagerly mount only the active
  pane's selected tab; hydrate sibling panes and parked tabs on
  `requestIdleCallback`. Consider raising `MAX_MOUNTED_EDITOR_CONTEXTS`
  toward the user's real workspace count (parked hosts are `display:none` and
  already bounded per pane).

## P03-08-15 — Workspace root is listed up to three times per switch, twice uncached

- **Status:** Resolved on 2026-08-04. `ensureWorkspaceReadAccess` now memoizes
  already-granted roots in-process: subsequent calls for a root confirmed
  readable earlier in the session return `"ready"` without a `readDir` or the
  workspace-access JSON read-modify-write. `probeWorkspaceReadAccess` stays a
  raw `readDir` (it exists to detect blocked access, so it must hit disk) — now
  documented as intentional.
- **Area:** Workspace switching / filesystem.
- **Impact:** **Medium** (large roots, network volumes).
  `ensureWorkspaceReadAccess` does a raw `readDir` plus a read-modify-write of
  the workspace-access JSON per switch; `probeWorkspaceReadAccess` does
  another raw `readDir`; only the third listing goes through
  `workspaceDirectoryCache`.
- **Fix complexity:** **S.**
- **Evidence:** `app/src/lib/services/appShellEffects.ts:144`;
  `app/src/lib/services/fileSystem.ts:102-114`, `:125-133`, `:135-155`;
  `app/src/lib/services/projectTreeController.ts:302-307`, `:329-334`,
  `:345`, `:359-367`.
- **Suggested solution:** Route both probes through the directory cache;
  memoize already-granted roots in-process.

## P03-08-16 — One catalog rebuild wipes the directory cache for every workspace

- **Status:** Resolved on 2026-08-04. The `onBeforeRebuild` callback now
  receives the rebuilding root and calls `workspaceDirectoryCache.invalidateUnder(root)`
  instead of `.clear()`, so cached listings for other open workspaces survive a
  rebuild in one workspace. Covered by `invalidateUnder` unit tests (scoped drop
  + no false match on shared-name prefixes). Per-root LRU sizing (the shared
  256-entry LRU still evicts across roots under pressure) is deferred as a
  capacity tuning item, not a correctness bug.
- **Area:** Directory cache / project tree.
- **Impact:** **Medium.** Any debounced catalog rebuild in the active
  workspace clears cached listings for **all** roots
  (`onBeforeRebuild: () => workspaceDirectoryCache.clear()`), and the single
  256-entry LRU is shared across roots so two large workspaces evict each
  other — a real hole in the per-workspace tree caching shipped on 08-02.
- **Fix complexity:** **S.**
- **Evidence:** `app/src/routes/+page.svelte:183-185`;
  `app/src/lib/components/AppShellHost.svelte:306-308`;
  `app/src/lib/services/workspaceDirectoryCache.ts:19`.
- **Suggested solution:** Invalidate only keys under the rebuilding root;
  size the LRU per root.

## P03-08-17 — Chat-session cache revalidation defeats itself

- **Status:** Resolved on 2026-08-04. The cache-first (`preferCachedIndex`)
  path now schedules the deferred 750 ms index re-read only when there is a
  genuine staleness signal — a persisted session in the in-memory index that
  has no thread entry yet. When every persisted session already has a thread
  entry (including `null` for empty/missing thread files), the cache is
  complete and no timer is armed. The `allPersistedHydrated` check no longer
  requires `persistedEntries.length > 0`, so workspaces with zero persisted
  sessions are trivially fully hydrated and no longer re-read the index on
  every re-entry.
- **Area:** Workspace switching / chat metadata (runs even with AI usage
  patterns that leave sessions on disk).
- **Impact:** **Medium.** The cache-first path always schedules a full index
  re-read 750 ms after every switch; a single never-opened session makes
  `allPersistedHydrated` false **forever**, so the deferred pass re-reads
  thread files on every switch; and the loaded-index signature is deleted
  whenever any deferred reads exist, making the cheap cache-hit branch
  frequently unreachable. A hole in the 08-02 "cache workspace session
  metadata" work (P02-08-08).
- **Fix complexity:** **M.**
- **Evidence:** `app/src/lib/state/chatStore/sessions.ts:38`, `:613-645`,
  `:670-676`, `:678-712`, `:730-740`, `:824-828`.
- **Suggested solution:** Gate deferred validation on a real staleness signal
  (index-file mtime or a persistence-side revision counter); track hydration
  per session; cancel the timer when leaving the root.

## P03-08-18 — Project-tree publish storm with double clones

- **Status:** Resolved on 2026-08-04. `publish()` now passes the live state
  reference to the subscriber instead of cloning (the subscriber only reads the
  snapshot, never mutates it), halving the per-publish clone cost. Ancestor
  directory loads in `ensureExpandedForActiveFile` now run in parallel via
  `Promise.all` instead of sequentially, collapsing N sequential disk I/O
  awaits + 2N publishes into concurrent loads with coalesced state updates.
- **Area:** Project tree controller.
- **Impact:** **Medium.** Every `publish()` clones the full tree state twice
  (cache + subscriber), and a single switch publishes several times; expanding
  ancestors for the active file loads **sequentially**, yielding 2 publishes
  per ancestor level. Each publish re-derives the flattened row list
  (rendering is virtualized, the derive is not).
- **Fix complexity:** **S–M.**
- **Evidence:** `app/src/lib/services/projectTreeController.ts:204-229`,
  `:247`, `:267`, `:325`, `:341-343`, `:357`, `:457-459`.
- **Suggested solution:** Coalesce publishes per microtask/rAF; skip the cache
  clone when it will be immediately overwritten; parallelize ancestor loads.

---

## Tab switching and editor reactivity

## P03-08-19 — Every store emit rebuilds full document strings in every live editor

- **Status:** Resolved on 2026-08-04. The controller now tracks
  `lastSyncedContent` (the editor/store content agreement, by reference) and
  compares incoming content by reference first, then length, and only falls
  back to `doc.toString()` when both disagree. The agreement reference is
  refreshed on mount, document switch, external apply, and the user-edit dirty
  listener (the new content string becomes the new agreement). Covered by
  regression tests asserting no dispatch occurs on same-reference, same-value,
  and post-edit echo emits.
- **Area:** Editor controller / hot path.
- **Impact:** **High.** `controller.update()` compares
  `next.content !== view.state.doc.toString()` — materializing the **entire
  buffer** (O(length) allocation) per live editor per app-state emit. With up
  to 4 live editors × 4 panes × 3 mounted contexts, one tab switch or cursor
  move can trigger dozens of full-document string builds; on MB-scale files
  this is tens to hundreds of ms plus GC pressure.
- **Fix complexity:** **S.**
- **Evidence:** `app/src/lib/editor/editorViewController.ts:563`, `:724`;
  update trigger `app/src/lib/components/EditorSurface.svelte:121`.
- **Suggested solution:** Track `lastSyncedContent` in the controller (set on
  mount, switch, external apply, and dirty-listener) and compare by reference
  first — the store's content string is usually the same instance the editor
  produced; fall back to length check, then `doc.toString()`.

## P03-08-20 — Object-valued stores invalidate all consumers on every mutation

- **Status:** Resolved on 2026-08-04. Object-valued app-state slices
  (`$appContexts`, `$appSettings`, `$appEditor`, `$appTheme`,
  `$appRecentFiles`, `$appActivityRailWidthPx`, `$appActiveContextId`,
  `$appActiveContext`, `$appActiveSession`, `$appActiveDocuments`,
  `$appOpenDocumentIds`) are republished through a new `stableDerived` wrapper
  that uses strict (`===`) equality instead of Svelte's `safe_not_equal`, so a
  reference-identical slice no longer re-notifies its consumers. Combined with
  the existing referential-stability selectors (which preserve object
  references when nothing changed), an unrelated `appState.update()` — a
  cursor move, a content edit in another document — no longer fans out to
  every component that reads any slice. Covered by `stableStore` unit tests.
- **Area:** State layer / Svelte reactivity.
- **Impact:** **High (systemic).** Svelte's `safe_not_equal` treats every
  object as changed, so `$appContexts`, `$appSettings`, `$appEditor`,
  `$appActiveContext/Session/Documents`, `$appOpenDocumentIds` re-notify all
  component consumers on **every** `appState.update()`, even when the emitted
  slice is reference-identical. The internal memoization only prevents deeper
  recompute, not consumer invalidation. This is the storm that makes
  P03-08-19/21/24 fire on every keystroke, cursor move, and tab switch.
- **Fix complexity:** **M.**
- **Evidence:** `app/src/lib/state/appStateSelectors.ts:17-18`, `:50`, `:72`,
  `:137`; Svelte internals `store.js`/`sources.js`/`equality.js`.
- **Suggested solution:** Publish slices via custom readables that skip `set`
  when the value is reference-identical (surgical), or migrate the snapshot
  to a `$state.raw` signal with leaf `$derived` selectors (structural).

## P03-08-21 — The ~60-field `editor` mega-prop couples cursor moves to full editor-tree updates

- **Status:** Resolved on 2026-08-04. The high-frequency cursor fields
  (`cursorLine`, `cursorColumn`, `selectionCount`) moved out of the `editor`
  chrome prop and into the existing `statusBar` prop, which is the only
  consumer. A cursor move (every keystroke / arrow press) no longer rebuilds
  the `editor={{ … }}` object literal in `AppShellHost`, so the
  `editorContextsById` → `mountedEditorContexts` → grid cells → pane/tab-bar
  → per-editor update-effect cascade no longer fires on cursor moves. The
  status bar still reads the (infrequently-changing) view-tab and document
  flags from `editor`.
- **Area:** AppShellHost → AppShell prop plumbing.
- **Impact:** **High.** The `editor={{ … }}` literal
  (`AppShellHost.svelte:774`) mixes high-frequency status-bar fields
  (`cursorLine`, `cursorColumn`, `selectionCount`) with editor-tree fields, so
  a cursor move rebuilds the object and re-evaluates every descendant that
  reads any field: `editorContextsById` → `mountedEditorContexts` → grid
  cells → every pane/tab-bar/pane-content prop expression → per-editor update
  effects (amplifying P03-08-19).
- **Fix complexity:** **M.**
- **Evidence:** `app/src/lib/components/AppShellHost.svelte:774`;
  `app/src/lib/components/AppShell.svelte:460-491`, `:498`, `:512`;
  `app/src/lib/components/EditorGridLayout.svelte:82`.
- **Suggested solution:** Move status-bar fields into the existing
  `statusBar` prop; split the remainder into stable-identity groups
  (`editorChrome` from settings/zoom/wrap; `editorDocs` from
  contexts/session/documents) or pass primitives directly.

## P03-08-22 — Editor LRU eviction synchronously serializes the full undo history

- **Status:** Resolved on 2026-08-04. The portable-session serializer now drops
  the unbounded `historyField` for documents at or above 256 KB, so eviction
  (and the matching restore) no longer serialize/deserialize the full undo
  stack — the dominant cost on the unmount/mount path for large files. Folds
  and bookmarks are preserved (cheap, high-value); small/medium files keep
  full undo across tab switches. Covered by a regression test asserting zero
  undo depth on restore of an evicted large document while folds/bookmarks
  survive.
- **Area:** Tab switching / editor keep-alive.
- **Impact:** **Medium–high.** Switching to a text tab outside the 4 most
  recent in a pane unmounts the evicted slot; `controller.destroy()` runs
  `state.toJSON(PORTABLE_EDITOR_FIELDS)` — serializing the full document
  **plus the entire unbounded undo stack** plus folds/bookmarks — and the new
  slot pays a full parse or history deserialize, synchronously in the
  unmount/mount path. With 18 tabs across 4 panes this is the *normal* path.
- **Fix complexity:** **M.**
- **Evidence:** `app/src/lib/editor/editorTabKeepAlive.ts:2`;
  `app/src/lib/editor/editorViewController.ts:797-830`;
  `app/src/lib/components/EditorPaneContent.svelte:507`.
- **Suggested solution:** Truncate or drop `historyField` from the portable
  snapshot; serialize in an idle callback; make the live limit adaptive to
  document size.

## P03-08-23 — Markdown outline runs a synchronous parse with a 5-second budget

- **Status:** Resolved on 2026-08-04. The `ensureSyntaxTree` budget was cut
  from 5 s to one frame (~16 ms); a partial tree is acceptable because the
  panel re-polls every 500 ms and the per-`EditorState` WeakMap memo reuses a
  completed parse for the rest of that document version. The poll now pauses
  while `document.hidden` (backgrounded/minimized) and resumes — with an
  immediate refresh — on `visibilitychange`. Covered by the existing
  `markdownHeadings` suite.
- **Area:** Markdown outline panel.
- **Impact:** **Medium (high for markdown-heavy use).**
  `ensureSyntaxTree(state, doc.length, 5000)` gives the parser a 5 s
  main-thread budget on every tab switch into a markdown doc and on every
  poll-detected change; the fallback path builds a throwaway `EditorState` +
  full parse. The panel also polls every 500 ms with no `document.hidden`
  gate.
- **Fix complexity:** **S.**
- **Evidence:** `app/src/lib/editor/markdownHeadings.ts:133`, `:139`;
  `app/src/lib/components/MarkdownOutlinePanel.svelte:119-133`.
- **Suggested solution:** Cut the budget to ~16 ms and accept partial trees
  (the existing poll re-schedules); pause the poll on blur/hidden; long-term,
  push heading updates from the editor instead of polling.

## P03-08-24 — Derived-identity churn batch (six small leaks that feed the storm)

- **Status:** Resolved on 2026-08-04 (landed after P03-08-20 so the remaining
  churn is measurable). (a) `enabledSnippets` now uses a WeakMap-memoized
  resolver keyed on the settings reference, plus a stable empty array for the
  non-markdown path, so the controller's snippet/completion key check is a
  no-op across unrelated emits. (b) `deriveAppShellDocumentView` gained a
  `deriveAppShellDocumentViewMemoized` variant keyed on the document
  reference (used by `+page.svelte` and the per-entry keep-alive loop), so
  the per-pane and per-entry view objects keep their identity across emits
  that don't change the document. (c) `normalizeWorkspaceLayout` gained a
  WeakMap-memoized variant keyed on the input layout reference. (d) The
  retain-cache effect now only re-runs when the open-document-id set genuinely
  changes membership (via the P03-08-20 `stableDerived` +
  referential-stability `appOpenDocumentIds`). (e) The watcher sync-key
  structural-equality gate now compares the resolved per-context watched-path
  sets directly instead of the session reference, so a tab switch (or cursor
  move) that leaves the watched set unchanged no longer forces a full
  `externalFileWatcherSyncKey` re-walk. (f) `notepadRecentTabs` keeps its
  array identity across emits that don't change the notepad session or
  documents.
- **Area:** Svelte deriveds / prop identity.
- **Impact:** **Medium combined; each Low.** Each returns a fresh
  object/array per emit, re-triggering downstream effects:
  (a) `enabledSnippets` fresh array per emit per editor
  (`DocumentEditor.svelte:50`); (b) `keepAliveEntries` fresh entry objects +
  `deriveAppShellDocumentView` re-run per entry per emit
  (`EditorPaneContent.svelte:370`, `:508`; `appShellDocumentView.ts:103`);
  (c) `normalizeWorkspaceLayout` always allocates
  (`+page.svelte:261-263`; `panelLayout.ts:61`); (d) retain-cache effect
  re-runs per emit (`+page.svelte:241-245`); (e) watcher sync-key re-walk on
  tab switches that cannot change the watched set
  (`appStateSelectors.ts:137-152`); (f) `notepadRecentTabs` fresh array per
  emit (`+page.svelte:461-478`).
- **Fix complexity:** **S each.**
- **Suggested solution:** WeakMap/reference memos and early-out guards at each
  site; land after P03-08-20 so remaining churn is measurable.

---

## Persistence

## P03-08-25 — Navigation-persist fingerprint copies and stringifies every document

- **Status:** Resolved on 2026-08-04. The change-detection fingerprint is now a
  cheap structural key built from topology + per-document metadata (id/title/
  path/dirty/kind) and the editor layout (panes/tabs/selection/slots) — never
  document content — so a debounced persist no longer maps every document in
  every context twice and `JSON.stringify`s the whole snapshot just to decide
  nothing changed. `stripBufferPayload` is deferred to the write-only path
  (`buildNavigationSnapshot`) and runs in the same single pass, and the
  navigation + buffer writes (per-window files with exactly one writer by
  construction, written atomically via temp + rename) now go through a new
  in-window-only chain (`enqueueSessionWriteInWindow`) instead of acquiring the
  cross-window lock directory — dropping the mkdir/owner-write/stat/remove IPC
  round-trips per persist. The shared chain still orders these writes against
  `session.json` writes, and the watchdog still bounds a hung write.
- **Area:** Incremental session persistence.
- **Impact:** **Low–medium.** Each debounced persist (1.2 s after a tab
  switch) maps **every document in every context** twice (persistence shape,
  then payload strip) and `JSON.stringify`s the result purely to compute a
  change fingerprint, then acquires the cross-window lock (mkdir/owner-write/
  stat/remove round-trips) even for per-window files that have exactly one
  writer by construction.
- **Fix complexity:** **S** (fingerprint) + **M** (lock scope).
- **Evidence:** `app/src/lib/services/sessionIncrementalPersistence.ts:143-181`;
  `sessionDocumentPersistence.ts:80-118`; `sessionWriteLock.ts` (heartbeat,
  retries); scheduled from `appShellEffects.ts:231`.
- **Suggested solution:** Fingerprint from a cheap structural key (context/
  pane/tab/document ids + dirty flags); strip buffers in one pass; skip the
  cross-window lock for single-writer per-window files.

## P03-08-26 — Buffer-fingerprint map retains full text of every document forever

- **Status:** Resolved on 2026-08-04. The per-document buffer fingerprint is
  now a djb2 hash + length of the content instead of the content itself, so the
  cache no longer retains the full text of every document ever persisted for the
  session. Buffer files and their fingerprint entries for documents no longer
  present in any context (closed tabs) are now detected as orphans during each
  persist and deleted, so neither the in-memory cache nor the growing
  `session-buffer.*.json` directory outlives the document — closing a tab frees
  its buffer immediately instead of waiting for the whole window session to be
  removed (and the restore `readDir` no longer walks stale buffer files).
- **Area:** Session persistence / memory.
- **Impact:** **Medium.** `bufferFingerprintByKey` stores the **entire
  content string** of every persisted document and is pruned only when a
  window session is removed — never on tab close. Long sessions retain every
  file ever opened → JS heap growth → GC pauses that compound with uptime and
  only clear on relaunch. Related: per-document `session-buffer.*.json` files
  are never deleted on tab close, and the growing directory is `readDir`ed on
  restore. Sibling caches are capped; this one is not.
- **Fix complexity:** **S.**
- **Evidence:** `app/src/lib/services/sessionIncrementalPersistence.ts:41`,
  `:58-70`, `:72-81`, `:159`, `:176-181`, `:336-341`.
- **Suggested solution:** Store a hash/length instead of the content; evict on
  tab close; delete the buffer file when its document closes.

---

## Logging and console

## P03-08-27 — Every log line pays stringify + IPC, including lines that are discarded

- **Status:** Resolved on 2026-08-04. `logDiagnostic` now mirrors the Rust
  plugin's `Info` cutoff on the JS side *before* `JSON.stringify` + IPC, so
  debug/trace payloads are dropped without ever being serialized or marshalled
  (the in-app console still receives every level via its own cheap path).
  Per-command git summaries are demoted to `debug` on the success path (failures
  stay `warn`), so the per-switch log spam no longer crosses the bridge.
  `verboseProviderLogging` now defaults to `false`, and verbose provider
  payloads are truncated per string value (8 KB cap) so a chat turn no longer
  deep-clones and ships unbounded request/response bodies only to be discarded.
- **Area:** Logging pipeline.
- **Impact:** **High (cheap fix, pays off everywhere).** Every
  `logDiagnostic` call `JSON.stringify`s its payload and makes one
  `plugin-log` IPC invoke at **every level including debug/trace**, while the
  Rust side filters at `Info` — debug lines are serialized, marshalled, and
  thrown away. Git logs each command at `info` (`gitRun.ts:167-188`, `:228`),
  which is the log spam observed. Worst case: `verboseProviderLogging`
  defaults to **true** (`logSettings.ts:4`) and deep-clones full chat
  request/response bodies with no size/depth cap
  (`chatDiagnostics.ts:18-31`, `:219`, `:241`, `:264`) only for the output to
  be dropped twice over.
- **Fix complexity:** **S.**
- **Evidence:** `app/src/lib/services/logging.ts:22-54`;
  `app/src-tauri/src/lib.rs:124`; `app/src/lib/git/gitRun.ts:167-188`;
  `app/src/lib/services/logSettings.ts:4`.
- **Suggested solution:** Filter by effective level *before* stringify + IPC;
  batch log writes; demote per-command git summaries to `debug`; default
  verbose provider logging to `false` and cap sanitized payload size.

## P03-08-28 — App console ring buffer copies 1000 entries per line and retains fat metadata

- **Status:** Resolved on 2026-08-04. The console store is now a pre-allocated
  fixed-size ring written through a head index (O(1) per append, no per-line
  ~1000-element clone). Subscriber notifications are coalesced per animation
  frame so a burst of lines notifies the panel once, not once per line. Entry
  metadata is serialized once, length-capped (2 KB), and retained only as a
  string — the live object reference is dropped so the ring never pins large
  provider payloads for 1000 subsequent lines. Command dispatch is demoted to
  `debug`, matching the doc comment's claimed filtering.
- **Area:** In-app console.
- **Impact:** **Medium.** At steady state each log line allocates two
  ~1000-element arrays and emits to all store subscribers whether or not the
  console is mounted; entry metadata objects are retained by reference for
  1000 subsequent lines with unbounded pre-formatted JSON; every command
  dispatch logs at `info` (`commands/registry.ts:92`), directly contradicting
  the filtering the doc comment at `appConsole.ts:23-28` claims, so the ring
  fills with dispatch noise; the mounted panel forces layout per appended
  line.
- **Fix complexity:** **S.**
- **Evidence:** `app/src/lib/services/appConsole.ts:14`, `:55`, `:59`, `:91`;
  `app/src/lib/commands/registry.ts:92`;
  `app/src/lib/components/ConsoleLogsPanel.svelte:15-21`.
- **Suggested solution:** True ring buffer (head index) or rAF-coalesced
  appends; cap serialized metadata and drop object references; demote command
  dispatch to `debug`.

---

## Beta features while disabled

Verified working as intended: with `settings.opencode.enabled = false` the
sidecar never spawns (`appShellEffects.ts:466-474`;
`opencodeSidecarEnsure.ts:190-205`), chat stores don't hydrate
(`appShellAgentHandlers.ts:234-241`), resource stores return disabled state,
and gated settings tabs are hidden. Remaining residue:

## P03-08-29 — Disabled-AI residual churn on every workspace switch

- **Status:** Resolved on 2026-08-04 (a–c). (a) The sidecar health effect's
  disabled branch no longer includes `activeWorkspaceRoot` in its dedup key, so
  switching workspaces while AI is off no longer writes a fresh `checkedAt`
  timestamp per switch — the `unknown` patch is published once and the state
  stops re-touching until AI is re-enabled. (b) The workspace chat-scope setup
  (`setActiveWorkspaceRoot` + restore) is skipped entirely when AI is disabled
  (the session tab is unreachable), so no empty per-workspace slice is created
  and the chat emit fan-out stays unwired; chat-http is unaffected. (c) The 15 s
  chat access poll now has an explicit `opencodeEnabled` gate and pauses while
  `document.hidden` (resuming with an immediate refresh on refocus); the
  session notification observer is gated on `opencodeEnabled` too. (d) remains
  open — the 250 ms JS-side sidecar health poll still duplicates the native
  Rust poller when AI is enabled.
- **Area:** AI gating hygiene.
- **Impact:** **Medium (pure waste).** (a) The sidecar health effect's probe
  key includes `activeWorkspaceRoot`, so every switch writes a fresh
  `checkedAt` timestamp into app state **even when AI is disabled** — a new
  state object per switch that triggers the full derived cascade including
  the settings fingerprint (P03-08-20/P03-08-24 amplifier). (b)
  `chatStore.setActiveWorkspaceRoot` runs unconditionally, creating empty
  per-workspace slices and keeping the chat emit fan-out wired. (c) The 15 s
  chat access poll and the session notification observer lack explicit
  `opencodeEnabled`/`document.hidden` gates (currently unreachable/cheap, but
  ungated). (d) The 250 ms JS-side sidecar health poll duplicates the native
  Rust poller when AI *is* enabled.
- **Fix complexity:** **S** (a–c), **M** (d).
- **Evidence:** `app/src/lib/services/appShellEffects.ts:145`, `:446-474`,
  `:718-724`; `app/src/routes/+page.svelte:710-726`;
  `app/src/lib/services/opencodeSidecarEnsure.ts:62-63`, `:122-156`;
  `app/src-tauri/src/opencode_sidecar.rs:580-640`.
- **Suggested solution:** Early-return before the health write when status is
  already `unknown`; skip chat scope setup when disabled; add explicit
  enabled/hidden gates; replace the JS health poll with a Rust-emitted
  transition event.

---

## Other

## P03-08-30 — Project search is strictly sequential with two IPC calls per file

- **Status:** Resolved on 2026-08-04. The scan loop now fans out via
  `mapWithConcurrency` (cap 12) so the per-file `stat` + `readTextFile` IPC
  round-trips overlap instead of serializing — a 5k-file workspace no longer
  pays 10k sequential awaits. The total-match cap, per-file size cap, image
  skipping, and `onProgress` abort are preserved through shared mutable scan
  state (safe under JS's single thread), with an `aborted` flag so a worker
  that observes the bail signals the others to short-circuit. A Rust-side
  `search_in_project` command (so contents never cross IPC) is deferred.
- **Area:** Project-wide search.
- **Impact:** **High on large workspaces.** The scan loop awaits `stat` then
  `readTextFile` per file, one file at a time — 10,000 sequential IPC
  round-trips for a 5,000-file workspace, with every file's full contents
  crossing the bridge to be discarded. `mapWithConcurrency` exists and is
  used elsewhere, but not here. (Caps and Enter-triggering are already
  sensible.)
- **Fix complexity:** **M** (concurrency) / **L** (Rust-side search).
- **Evidence:** `app/src/lib/services/projectSearch.ts:140-175`.
- **Suggested solution:** Near-term `mapWithConcurrency` (8–16); proper fix is
  a Rust `search_in_project` command so contents never cross IPC.

## P03-08-31 — Search results and project replace lack virtualization, progress, and cancellation

- **Status:** Resolved on 2026-08-04. The results list now caps rendered match
  rows per file (50) with a "Show N more matches in this file" affordance, so a
  broad query no longer mounts ~10k unvirtualized DOM rows on the initial paint
  (file headers remain bounded by file count). Per-file collapse/expansion
  state resets when a fresh result set lands. The project replace loop now
  reports progress (`Replacing… i/N files`) every ~5% and honors the search
  generation, so starting a new search or closing the panel cancels an
  in-flight replace instead of running it to completion in the background.
- **Area:** Search/replace UX.
- **Impact:** **Medium.** A broad query can mount ~10k unvirtualized DOM rows
  (`ProjectSearchPanel.svelte:300`, `:316`; cap comment acknowledges it);
  replace-in-project loops files serially with a read+write pair per file and
  no progress or cancel (`overlayHostHandlers.ts:235-243`).
- **Fix complexity:** **M.**
- **Suggested solution:** Virtualize the results list; batch replaces with
  concurrency, progress reporting, and an abort.

## P03-08-32 — Small leak batch

- **Status:** Resolved on 2026-08-04 (a, b). (a)
  `tabCheckFreshnessGenerationByDocument` is now bounded by the same LRU cap
  (256) as the sibling completion cache via a shared `bumpTabCheckFreshnessGeneration`
  helper, and `clearDocumentExternalChangeState` now deletes the generation
  entry on tab close instead of routing through the bumping invalidator (which
  retained it). (b) `evictWorkspaceSessionHydration` now drops
  `inFlightThreadHydrates` entries keyed under the evicted scope, closing the
  one per-scope map that survived workspace eviction. (c) Audited: the three
  `void listen()` registrations each already capture and invoke their unlisten
  in a finish/dispose path (not actual leaks today; the hypothetical per-window
  concern stands but no change was warranted). (d) deferred — workspace
  file-catalog registry entries are arrays only and memory does not lag.
- **Area:** Memory hygiene.
- **Impact:** **Low.** (a) `tabCheckFreshnessGenerationByDocument` has no cap
  and one non-deleting path (`externalFileChanges.ts:57`, `:108-113`, `:200`);
  (b) `inFlightThreadHydrates` is the one per-scope map not cleared by
  eviction (`chatStore/sessions.ts:27`, `:88-96`); (c) three `void listen()`
  registrations without stored unlisten (`appShellPageHandlers.ts:527`,
  `windowManager.ts:158`, `tabWindowTransfer.ts:74`) — app-lifetime today,
  silent leaks if they ever become per-window; (d) workspace file-catalog
  registry entries retained until workspace close (arrays only, memory not
  lag). Listener hygiene is otherwise good; all other caches verified
  bounded.
- **Fix complexity:** **S.**

---

## Feature tasks

## P03-08-T1 — Setting to completely disable git (and scope it to Version Control)

- **Status:** Resolved on 2026-08-03.
- **Area:** Settings / git integration.
- **Impact:** **High** (user-facing control; also the fastest mitigation for
  P03-08-06/07 while the fixes land).
- **Complexity:** **M.**
- **Current state:** `settings.gitIntegration` already exists
  (`gitIntegrationSettings.ts:3-58`) with `enabled` (master kill switch —
  blocks `runGit`, closes VC tabs, drains subprocesses, hides menus),
  `autosaveBeforeOperations`, `showProjectTreeBadges`,
  `showWorkspaceManagerGitColumn`. UI: Settings → "Version Control"
  (`VersionControlSettingsPanel.svelte:49-66`). Gating predicates live in one
  module (`gitIntegrationGating.ts`) but have **no view-awareness**. Trap:
  disabling `showProjectTreeBadges` silently falls back to an OpenCode
  `file.status` HTTP call (`fileStatusTracker.ts:186-191`) instead of "off".
- **Plan:**
  1. Add `gitIntegration.scope: "always" | "versionControlOnly" | "off"`
     (normalize + defaults in `gitIntegrationSettings.ts`); render as a
     radio/select in `VersionControlSettingsPanel.svelte` next to the master
     toggle. `"off"` must behave exactly like `enabled: false`.
  2. Add view-awareness to `gitIntegrationGating.ts`: a predicate for "a
     version-control tab is active in some pane" (exists in spirit at
     `EditorPaneContent.svelte:218` / `editorRouting.ts:43`);
     `shouldLoadProjectTreeGitBadges()` and
     `shouldLoadWorkspaceManagerGitColumn()` return false unless scope is
     `"always"`.
  3. Belt-and-braces at the single chokepoint: extend `runGit`
     (`gitRun.ts:296-325`) with a required `scope: "versionControl" |
     "background"` tag and reject background calls when scoped to VC-only —
     mirrors the existing `enabled` early-return, so one edit covers every
     current and future call site.
  4. Fix the OpenCode fallback: when git is off/scoped away,
     `fileStatusTracker` must return the empty state, not switch data source.
  5. Settings plumbing per the established pattern: type + default +
     normalizer + `appState` setter + `settingsPersistenceFingerprint` +
     `toPersistedSettings` + panel checkbox.
- **Acceptance criteria:** With scope `"versionControlOnly"`, zero git
  processes appear in logs during workspace/tab switching and Workspace
  Manager use; git commands run only while a VC tab is active. With `"off"`,
  zero git processes ever, and tree badges are absent (not OpenCode-sourced).

## P03-08-T2 — Active performance-log collection with downloadable report

- **Status:** Resolved on 2026-08-04. `logPerfTiming` now captures every sample
  into a dedicated bounded in-memory ring (cap 2000, head-index O(1)) *before*
  the log hop, so debug-level samples that the Rust plugin discards are still
  retained for export. Collection is gated by a new
  `settings.logSettings.collectPerfLogs` toggle (default off; the ring is
  allocation-free while disabled and cleared on disable), mirrored into the
  perf module reactively from `+page.svelte`. `serializePerfReport` emits JSON
  with per-metric count/min/max/p50/p95 plus the raw samples, a stable per-run
  id, the app version, and a caller-supplied settings snapshot;
  `serializePerfReportMarkdown` renders the same as a table. `downloadPerfReport`
  wires the save dialog + atomic write (the report lands on disk without
  crossing the session-write lock). Covered by perf ring + serialize unit tests.
- **Area:** Diagnostics.
- **Impact:** **Medium** (unblocks measuring all fixes above).
- **Complexity:** **M.**
- **Current state:** `perfDiagnostics.ts` exposes `logPerfTiming` /
  `measureAsync` over a closed union of 10 metrics, tagged
  `metadata.kind === "perf"`, with 29 call sites. Samples exist **only as
  formatted log strings** interleaved in the appConsole ring and the Rust log
  file. There is no sample store, no aggregation, no query/filter, no export
  path, no run-correlation id, and no way to read the Rust log file back from
  the frontend. Debug-level perf samples never reach the console ring at all.
- **Plan:**
  1. Add a dedicated bounded in-memory perf sample ring (separate from
     appConsole), populated directly inside `logPerfTiming` *before* the log
     hop — sidesteps the P03-08-27 noise entirely. Include a per-run session
     id and monotonic timestamps.
  2. Add a "Collect performance logs" toggle (Settings → Logs panel,
     `LogsSettingsPanel.svelte`, following the `logSettings.ts` pattern).
     When active, capture all perf metrics regardless of console level, and
     optionally raise sampling coverage (tab-switch, workspace-switch,
     file-open, git-command timings — the paths in this review).
  3. `serializePerfReport()`: JSON (and/or markdown summary) with per-metric
     count/min/max/p50/p95, the raw samples, app version, and settings
     snapshot relevant to perf (git scope, watcher counts, workspace count).
  4. "Download report" action: settings panel button + console toolbar button
     (see T3), saved via the existing dialog plugin / `atomicWriteTextFile`.
- **Acceptance criteria:** Toggling collection on records samples with no
  measurable overhead when off; the exported report contains aggregated and
  raw samples correlated to one run; works with AI disabled.

## P03-08-T3 — Clear-logs button in the app console

- **Status:** Resolved on 2026-08-04. `ConsolePanel` now has a toolbar with a
  Clear button (wired to `clearConsoleLogs()`), a minimum-level dropdown (wired
  to `setMinConsoleLevel()`), a Copy-visible button (writes the current ring
  snapshot to the clipboard), and the T2 perf-report download button (disabled
  until collection is armed). All buttons are keyboard-accessible `<button>` /
  `<select>` elements with aria-labels.
- **Area:** Console UI.
- **Impact:** **Low** (quality of life).
- **Complexity:** **S.**
- **Current state:** `clearConsoleLogs()` (`appConsole.ts:64`) and
  `setMinConsoleLevel()` (`appConsole.ts:31`) exist and are fully tested but
  have **zero call sites outside tests**. `ConsolePanel.svelte` /
  `ConsoleLogsPanel.svelte` have no toolbar at all (only a resize handle and
  a 250-entry render window).
- **Plan:** Add a small toolbar to `ConsolePanel.svelte`: Clear button wired
  to `clearConsoleLogs()`; while at it, a level-filter dropdown wired to
  `setMinConsoleLevel()` and a Copy-visible button are nearly free. Add the
  perf-report download button here once T2 lands.
- **Acceptance criteria:** Clear empties the ring and the panel immediately;
  filter changes apply to subsequent entries; buttons are keyboard-accessible.

---

## Suggested implementation order

1. **Stop the bleeding (all S):** P03-08-01 (lock spin), P03-08-02
   (`spawn_blocking` + read timeout), P03-08-27 (log level filter before
   IPC + demote git logs), P03-08-06 (effect deps + TTL cache),
   P03-08-07 (concurrency cap + cache), P03-08-13 (sorted watcher key),
   P03-08-19 (`lastSyncedContent` guard). These directly address all three
   reported symptoms.
2. **The disable-git setting** P03-08-T1 — user-facing control and a
   guarantee the regression class can't return.
3. **Watcher architecture:** P03-08-12 then P03-08-11 (async command, batched
   FSEvents updates, multi-root watching).
4. **Reactivity storm:** P03-08-20, then P03-08-21, then the P03-08-24 batch.
5. **Resilience:** P03-08-03 (watchdog + split chain), P03-08-08 (queue
   lanes/timeouts), P03-08-04, P03-08-05.
6. **Measurement:** P03-08-T2 + P03-08-T3, ideally early enough to verify
   steps 1–5 with real numbers.
7. **Remainder as convenient:** P03-08-09/10/14/15/16/17/18/22/23/25/26/28/
   29/30/31/32.
