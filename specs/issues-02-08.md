# Workspace interaction issues — 2026-08-02 audit

Investigation of lag while opening and switching workspaces, files, panes, and
tabs, plus the failure to open dot-prefixed files from the project pane.

The findings combine source tracing with the app's local structured performance
log. Relevant observed timings were:

- File-tab activation side effects: normally 6–16 ms, worst observed 592 ms.
- Workspace restore: worst observed 224 ms.
- Project-tree root load: paired 590/599 ms loads for one switch; paired 3/10 ms
  loads for another switch.
- Current persisted window session: approximately 74 KB, including one
  workspace with 18 documents/tabs across 4 panes.

Complexity scale: **S** = small (isolated, up to a few hours), **M** = medium
(roughly half to one day, moderate risk), **L** = large (multi-day or
architectural work).

---

## P02-08-01 — Dot-prefixed files are rejected by filesystem scopes

- **Status:** Resolved as a quick win on 2026-08-02.
- **Area:** Project pane / filesystem permissions / asset previews.
- **Impact:** **High.** Hidden files appeared in the project tree but clicking
  them could fail without opening a tab. Hidden image previews could be affected
  by the equivalent asset-protocol scope behavior.
- **Fix complexity:** **S.** Completed.
- **Evidence:** Both filesystem and asset-protocol scope matching used
  `requireLiteralLeadingDot: true` while their broad allow globs did not contain
  literal dot-prefixed path components. Existing external-file tests also
  characterize the resulting `allow-stat` rejection for `.gitignore`.
- **Suggested solution:** Allow scope globs to match leading-dot components for
  ordinary workspace files while retaining explicit deny rules for credentials,
  keychains, private keys, and other sensitive locations. This is now done by
  setting `requireLiteralLeadingDot` to `false` for both scopes; all existing
  explicit deny rules remain active.
- **Acceptance criteria:** Rebuild and restart the desktop application, enable hidden
  files in the project pane, then open representative text, image, and binary
  dotfiles. Confirm sensitive denied paths remain inaccessible.

## P02-08-02 — Workspace switches start duplicate project-tree root loads

- **Status:** Resolved as a quick win on 2026-08-02.
- **Area:** Workspace switching / project tree.
- **Impact:** **Medium–high.** Each workspace switch could schedule two root
  loads, duplicate controller publications, and compete with other switch-time
  filesystem work. The shared directory cache could coalesce some underlying
  reads, but it did not eliminate the duplicate control flow and rendering.
- **Fix complexity:** **S.** Completed.
- **Evidence:** The performance log contained paired root-load completions for
  the same switch: 590/599 ms and 3/10 ms. Source tracing found both the
  root-keyed shell effect and the active-context handler calling the loader.
- **Suggested solution:** Keep a single owner for switch-time project-tree
  synchronization. The root-keyed shell effect is the appropriate owner because
  it already handles runtime readiness and root changes. The direct call was
  removed from the active-context handler, with regression coverage ensuring it
  does not return.
- **Acceptance criteria:** A workspace-root change schedules exactly one tree
  load; repeated effects for the same root remain no-ops; switching to a context
  without a project tree follows the shell's explicit clear/preserve policy.

---

## Open — file opening and tab activation

## P02-08-03 — File opening performs full-session registry reads and rewrites

- **Status:** Resolved on 2026-08-02.
- **Area:** File opening / multi-window ownership / persistence.
- **Impact:** **High.** Opening a new file waits for a full `session.json` read
  to discover ownership, then waits for a cross-window lock, another full
  session read, and a full session rewrite to claim ownership. Cost grows with
  every persisted window, document, and unsaved buffer.
- **Fix complexity:** **M–L.** Completed; multi-window correctness required an
  atomic pre-open reservation and a separate transfer handoff.
- **Evidence:** `requestOpenPath` calls `readOpenFileRegistry`; successful opens
  later call `claimOpenFile`. Both registry operations decode the complete
  session snapshot, and claiming rewrites it. The observed session file is
  approximately 74 KB and contains open document contents.
- **Suggested solution:** Move the open-file ownership registry into a small
  dedicated persistence file guarded by the existing cross-window lock, or add
  a native process-wide ownership service with atomic claim/release commands.
  Keep a per-window in-memory snapshot so ordinary lookups avoid disk. Update
  the session topology and registry in one queued background operation after the
  editor tab is visible; only a confirmed cross-window owner should block the
  visible open. Implemented with a versioned `open-files.json`, atomic writes
  under the existing cross-window lock, event-coherent per-window caches, an
  atomic claim before file I/O, failed-reservation cleanup, atomic ownership
  handoff for tab transfers, and startup pruning against the live window set.
  Session persistence no longer reads or rewrites ownership during ordinary
  file opens.
- **Acceptance criteria:** Opening cost is independent of total buffer content;
  concurrent windows cannot both claim the same normalized path; crash recovery
  removes stale owners; no complete session decode/write occurs on the normal
  single-window open path. Covered by registry, open-gate, open-path, transfer,
  and session-persistence tests.

## P02-08-04 — Clicking an already-open file rereads its complete contents

- **Status:** Resolved on 2026-08-02.
- **Area:** Project pane / file activation.
- **Impact:** **Medium–high.** Focusing an existing tab can incur stat, file read,
  decode, fingerprint, and document-state update work. This is especially
  noticeable for large files and cloud, network, or externally mounted roots.
- **Fix complexity:** **S–M.** Completed with activation and external-change
  policy coverage.
- **Evidence:** The `existing` branch of `openActivePath` unconditionally calls
  `refreshExistingDocumentFromDisk` unless the document is waiting for large-file
  confirmation.
- **Suggested solution:** Focus the existing document immediately. If external
  checks are enabled, compare a cheap metadata fingerprint in the background
  and read contents only when metadata differs. Reuse the existing external-file
  conflict policy for dirty buffers instead of silently refreshing during tab
  focus. Implemented by scheduling the existing external-change engine after
  activation rather than awaiting a direct full-file refresh. File-to-pane drops
  now move the existing tab without replacing its buffer before scheduling the
  same check.
- **Acceptance criteria:** Clicking an unchanged open file performs no content
  read; the tab focuses immediately; changed clean files still refresh; changed
  dirty files still use the configured conflict flow. Covered by open-path and
  external-file-change tests, including preservation of unsaved pane-drop
  content.

## P02-08-05 — Tab activation checks are repeated across short tab cycles

- **Status:** Resolved on 2026-08-02.
- **Area:** Tab switching / external-file detection.
- **Impact:** **High on slow filesystems; medium otherwise.** A tab switch can
  trigger disk work that took 592 ms in the captured log.
- **Fix complexity:** **M.** Completed with watcher, focus, expiry, and rapid-cycle
  regression coverage.
- **Evidence:** The activation cooldown stores only one document id for 600 ms.
  Switching A → B → A replaces the remembered id and checks A again, even when
  both files were checked moments earlier.
- **Suggested solution:** Replace the single last-check record with a bounded
  per-document timestamp map and use a longer freshness window when the native
  watcher is active. Run activation checks after the visual tab commit (idle or
  background task), deduplicate in-flight checks by document id, and invalidate
  freshness immediately on watcher events, app focus, or explicit refresh.
  Implemented with a 256-entry LRU-style completion cache, a five-second
  watcher-backed freshness window, deferred zero-delay checks, and one pending
  check per document. Authoritative watcher, focus, startup, manual, and close
  paths invalidate freshness; queued tab work is cancelled where possible, and
  already-running tab work is followed by the authoritative check.
- **Acceptance criteria:** Rapid cycling among unchanged tabs does not issue
  repeated stats; watcher-reported changes are not delayed; returning from app
  background still performs the required safety check. Covered by A → B → A,
  expiry, watcher invalidation, and queued-check cancellation tests.

---

## Open — editor lifecycle and workspace switching

## P02-08-06 — Context changes destroy visited editor keep-alive slots

- **Status:** Resolved on 2026-08-02.
- **Area:** Workspace switching / CodeMirror lifecycle.
- **Impact:** **High with many visited tabs and panes.** Switching context resets
  the visited-tab set, unmounts its file-editor slots, destroys their CodeMirror
  views, and constructs destination views. The current session includes a
  workspace with 18 tabs across 4 panes, making this lifecycle cost material.
- **Fix complexity:** **L.** Completed with keyed context hosts and bounded LRU
  ownership of live controller trees.
- **Evidence:** `EditorPaneContent` resets `visitedEditorTabIds` whenever
  `contextId` changes. Removing the keep-alive entries destroys `EditorSurface`;
  controller teardown destroys the view and invalidates controller-bound cached
  session state.
- **Suggested solution:** Preserve a bounded editor subtree per recently used
  context, or make editor session state portable across controller destruction.
  The preferred long-term design is a workspace/context editor host registry:
  keep the active context mounted, park a small number of recent contexts, and
  evict least-recently-used contexts after saving a controller-independent
  editor snapshot. Avoid keeping every workspace DOM tree live indefinitely.
  Implemented as keyed context hosts retaining the active context plus two
  recently used contexts. Parked hosts use `display: none` without destroying
  their editor controllers; reactivation triggers editor measurement. Closed
  contexts and LRU overflow unmount normally. Late content and scroll callbacks
  are context-aware so parked controllers cannot update a different context
  with overlapping document ids.
- **Acceptance criteria:** Switching away and back to a recent workspace does
  not reconstruct its visible editor; selection, folds, undo history, and scroll
  survive because the keyed editor view remains mounted; total live context
  trees are bounded to three. LRU ordering, close pruning, hard bounds, and
  parked-context state routing have regression coverage.

## P02-08-07 — Visited text tabs retain an unbounded number of live editors

- **Status:** Resolved on 2026-08-02.
- **Area:** Tab switching / memory / DOM size.
- **Impact:** **Medium–high over long sessions.** Every visited text tab in a
  pane retains a live CodeMirror instance until that tab closes. Hidden slots do
  not paint, but still retain editor state, DOM, extensions, observers, and
  language services.
- **Fix complexity:** **L.** Completed with a bounded per-pane live-editor LRU
  and portable controller-independent session snapshots.
- **Evidence:** The visited set grows whenever a new text tab is activated and
  is pruned only when tabs close or the context changes; there is no live-editor
  limit or LRU eviction.
- **Suggested solution:** Introduce a per-pane LRU with a small configurable live
  limit, but first separate portable editor state from controller-specific
  compartments. Eviction should serialize document text identity, selection,
  scroll, folds, bookmarks, and undo history into a controller-independent
  cache; reactivation should restore that snapshot without a disk reread.
  Implemented with a four-editor per-pane live limit. Evicted views serialize
  document identity/content, selection, scroll, folds, bookmarks, and undo
  history into the existing bounded ephemeral session cache. Reactivation builds
  fresh extension compartments from that snapshot and recent tabs remain mounted
  for CSS-only switching.
- **Acceptance criteria:** Live editor count remains bounded as tabs are visited;
  revisiting an evicted tab preserves user-visible editor state; switching among
  the most recent tabs remains a CSS-only visibility change. LRU bounds,
  pruning, portable cache separation, and eviction restoration have regression
  coverage.

## P02-08-08 — Workspace switching rereads chat-session metadata unnecessarily

- **Status:** Resolved on 2026-08-02.
- **Area:** Workspace switching / chat session hydration.
- **Impact:** **Medium.** Ordinary workspace navigation performs chat-session
  index I/O even when the selected destination is a file or view tab. The
  captured workspace restore reached 224 ms.
- **Fix complexity:** **M.** Completed with cache-first re-entry and coalesced
  deferred validation.
- **Evidence:** Every new workspace scope invokes `restoreWorkspaceSession`,
  which calls `loadWorkspaceSessions`. Hydrated threads can be reused, but the
  persisted session index is still read on each re-entry.
- **Suggested solution:** Keep a per-root in-memory index with a generation or
  fingerprint updated by chat persistence. For ordinary file/view destinations,
  restore the cached index synchronously and defer validation until idle. Read
  immediately only when entering a session tab, when a watcher signals index
  changes, or when the user explicitly refreshes sessions.
  Implemented by reusing the per-root chat-store workspace index immediately for
  ordinary file/view re-entry. Validation is coalesced per root and deferred for
  750 ms; session-tab entry continues to read immediately. The existing hydrate
  generation prevents stale validation results from winning over newer loads.
- **Acceptance criteria:** Re-entering a cached workspace on a file tab performs
  no synchronous chat-index read; opening a session tab still sees current
  metadata; externally added or removed sessions become visible after watcher
  invalidation or explicit refresh. Covered by cache-first restore and deferred
  external-index update tests.

---

## Open — persistence and project tree

## P02-08-09 — Tab selection persists the complete session and backup

- **Status:** Open.
- **Area:** Session persistence / filesystem contention.
- **Impact:** **Medium.** Writes are debounced and asynchronous, but every pause
  after tab selection can serialize all window topology and open buffer contents,
  promote the old primary to backup, and atomically replace the primary. This can
  contend with file reads, external checks, tree loading, and registry claims.
- **Fix complexity:** **M–L.** Durability and multi-window ordering must remain
  correct.
- **Evidence:** The session-persistence effect schedules persistence when the
  selected tab changes. `persistSessionSnapshot` reads the existing snapshot and
  writes the full window snapshot plus backup through the shared lock.
- **Suggested solution:** Separate lightweight navigation topology from buffer
  payload persistence. Persist selected context/pane/tab ids in a small record;
  persist changed buffers by document id only when their content revision changes.
  Batch topology and dirty-buffer updates through one queue, and retain the full
  snapshot only for explicit checkpoints or application close. No compatibility
  migration is required while the app remains in active development.
- **Acceptance criteria:** Selecting a tab with unchanged buffers writes only a
  small topology record; dirty buffer contents are not repeatedly serialized;
  crash restore and multi-window ordering remain correct.

## P02-08-10 — Project-tree state is not cached per workspace

- **Status:** Resolved on 2026-08-02.
- **Area:** Workspace switching / project tree / slow filesystems.
- **Impact:** **Medium, potentially high on cloud or network roots.** Removing
  the duplicate load still leaves a single root load that took approximately
  590 ms in the captured Notes workspace. Switching away replaces the
  controller's root nodes, expanded paths, and children state, so revisiting a
  workspace cannot display its previous tree immediately.
- **Fix complexity:** **M.** Completed with bounded per-root snapshots and
  targeted stale-directory refresh.
- **Evidence:** The controller owns one `ProjectTreeControllerState` and one
  `lastLoadedWorkspaceRoot`. The shared directory cache can reuse listings, but
  it does not preserve a renderable per-root tree snapshot and may be invalidated
  by watcher activity.
- **Suggested solution:** Store bounded per-root tree snapshots containing root
  nodes, expanded paths, and loaded children. On switch, publish the cached
  snapshot immediately, then refresh invalidated directories in the background.
  Route watcher events to the affected root even when it is inactive, marking
  only impacted cached directories stale. Use an LRU cap across closed or rarely
  used workspaces.
  Implemented in the project-tree controller with a six-root LRU containing root
  nodes, expanded paths, and loaded children. Cached state publishes before any
  I/O. Filesystem events are matched to the longest cached root, inactive trees
  record only affected renderable directories as stale, and those directories
  refresh after the cached tree is shown. Shared directory listings are
  invalidated for every matching open workspace root.
- **Acceptance criteria:** Returning to a cached workspace paints its previous
  tree without waiting for `readDir`; changed directories refresh correctly;
  cache size remains bounded; manual refresh still forces a complete rebuild.
  Covered by immediate publication, expanded-child restoration, inactive-root
  invalidation, LRU eviction, race prevention, and forced-refresh tests.

---

## Suggested implementation order

1. **P02-08-04** and **P02-08-05** — remove unnecessary reads from common file
   and tab activation paths.
2. **P02-08-03** — decouple file ownership from the full session snapshot.
3. **P02-08-08** and **P02-08-10** — make workspace re-entry cache-first.
4. **P02-08-06** and **P02-08-07** — redesign editor parking and eviction as one
   coordinated lifecycle change.
5. **P02-08-09** — split navigation topology from buffer persistence.

P02-08-01 and P02-08-02 are already resolved and should remain covered by
regression tests.
