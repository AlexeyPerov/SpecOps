# Performance issues — 2026-07-18 audit

Findings from a full performance audit (launch, tab switching, workspace
switching, cross-cutting). Status tracks what shipped and what remains.

Already shipped in the two commits dated 2026-07-18:

- Launch waterfall parallelization (listeners, JSON reads, background phases,
  skip backup write).
- Editor tab keep-alive + workbench multi-host + targeted session-cache
  invalidation.
- Version Control git probe memoization across mounts.
- Defensive chat scroll restore on tab re-entry.
- Derived-store memoization (`chatMessages`, `chatSessionIndex`,
  `chatActiveRuntimeBySessionId`, `chatSessionSubtitleById`) + `getSnapshot()`
  subscribe/unsubscribe removal.
- Quick wins: settings-dedup theme migration, batched connection-key restore,
  debounced session persistence on tab change, deduped OpenCode health probe,
  indexed workspace context lookups, memoized theme list.

Complexity scale: **S** = small (≤1h, isolated), **M** = medium (~half day,
moderate risk), **L** = large (1+ days, invasive).

---

## Open — medium / large

### Launch / bundle

#### L1. ~~No code-splitting — heavy initial bundle~~ ✅ Resolved
- **Status:** Shipped. The 5 picker overlays and the 4 sync CodeMirror language
  packs now load on demand; a `manualChunks` rule isolates the CodeMirror
  language packs and highlight.js into separately-cacheable chunks. Main app
  chunk dropped ~35% (~1.98 MB → ~1.27 MB). highlight.js itself stays eager
  (sync chat-markdown API constraint — deferred). See the 2026-07-19 07:50
  changelog entry.

#### L2. Workspace file catalog walks the whole tree at startup
- After the launch-waterfall fix this phase runs in the background, but it
  still recursively enumerates the entire workspace on every launch.
- **Files:** `app/src/lib/services/workspaceFileCatalog.ts:267-290`,
  `app/src/lib/services/workspaceTraversal.ts:102-160`.
- **Complexity: S-M.**
- **Fix sketch:** Make enumeration incremental (lazy-populate deeper folders
  as the picker expands them), or cache the result per root and invalidate on
  file-watcher events only.

#### L3. `+page.svelte` constructs 12 handler/controller factories at module-eval
- All controller factories are allocated before first paint. Individually
  cheap; the real cost is the monolithic reactive graph (see L11).
- **Files:** `app/src/routes/+page.svelte:164-252`.
- **Complexity: L** (tied to L11).

### Tab switching (chat + per-keystroke)

#### L4. ~~ChatPanel re-runs capability preflight on every mount~~ ✅ Resolved
- **Status:** Shipped. ChatPanel keeps a module-scoped per-workspace preflight
  cache (15s TTL) keyed by provider/model/settings fingerprint. Tab
  away-and-back within the TTL restores `supportedModes` synchronously and
  skips `runAccessPreflight` + capability IPC. Provider/model/settings changes
  miss the cache even inside the TTL. See the 2026-07-19 13:10 changelog entry.

#### L5. ~~`extractSessionTotals` loops every message on every chat-tab mount~~ ✅ Resolved
- **Status:** Shipped. `extractSessionTotals` is WeakMap-memoized by the
  messages array reference, so remounts and subtitle derivations that re-read
  the same thread array skip the assistant/step walk. See the 2026-07-19 13:10
  changelog entry.

#### L6. `EditorPaneContent` recomputes per-pane doc lookup + markdown HTML per keystroke
- `paneDocument` does an `Array.find` over documents; `deriveAppShellDocumentView`
  recomputes `markdownHtml` on every `appState` tick (including cursor moves
  and keystrokes via `setDocumentContent`). Partially mitigated by keep-alive
  (only the active slot recomputes), but the markdown HTML path still runs per
  edit.
- **Files:** `app/src/lib/components/EditorPaneContent.svelte:235-257`,
  `app/src/lib/services/appShellDocumentView.ts:23-62`.
- **Complexity: M.**
- **Fix sketch:** Memoize `markdownHtml` by document content reference; lift
  the doc-by-id map so the find is not repeated.

#### L7. `buildDocumentByIdMap` rebuilt in two components per emit
- `EditorPaneView` and `TabBar` each independently rebuild a `Map` from the
  documents array on every appState emit.
- **Files:** `app/src/lib/components/EditorPaneView.svelte:82`,
  `app/src/lib/components/TabBar.svelte:99`.
- **Complexity: S.**
- **Fix sketch:** Memoize at the parent, or derive one shared map and pass it
  down.

#### L8. `TabBar` rebuilds visible-tab filter, drag-preview, and sessionTitle Map per emit
- `visibleTabs`, `tabsForRender`, and `sessionTitleById` all recompute on every
  store update.
- **Files:** `app/src/lib/components/TabBar.svelte:99-206`.
- **Complexity: S-M.**
- **Fix sketch:** Memoize each derivation on its input references.

#### L9. ~5 top-level `$effect`s fire on every tab select
- Hydration, persistence, sidecar, access monitor, and tool-close effects all
  re-run on tab activation. Some are inherent; many could be guarded finer.
- **Files:** `app/src/routes/+page.svelte:1391-1662, 470-483`.
- **Complexity: L** (tied to L11).

### Workspace switching

#### L10. ~~`{#key editor.contextId}` tears down the whole editor grid on every switch~~ ✅ Resolved
- **Status:** Shipped. The `{#key}` was removed by namespacing every editor
  identity surface (host registry, session cache, keep-alive state, DOM pane
  attributes, active-context bias) by `contextId` and threading `contextId`
  through the full editor component stack. Editor trees for all contexts now
  stay mounted across a switch. See the 2026-07-18 23:00 changelog entry.

#### L11. Two concurrent filesystem walks fire per switch (no shared traversal)
- The project-tree root `readDir` and the catalog's recursive
  `enumerateOpenableWorkspaceFiles` both walk the tree independently.
- **Files:** `app/src/lib/services/projectTree.ts:55-90`,
  `app/src/lib/services/workspaceTraversal.ts:102-160`.
- **Complexity: M.**
- **Fix sketch:** Share one traversal between the tree and the catalog, or
  have the catalog derive from the tree.

#### L12. ~~`loadWorkspaceSessions` re-reads every session thread from disk~~ ✅ Resolved
- **Status:** Shipped. The loader now tracks a per-scope signature of the
  last persisted sessions index it fully loaded, and skips re-reading every
  session's thread file when that signature still matches the on-disk index
  AND every persisted session already has a thread entry in memory (the
  common path on workspace re-entry). When the cache is current, only the
  index file is re-read and the session index is refreshed in one store
  update — zero thread-file reads. When the index has gained or shed
  sessions, only the delta (missing threads) is read; existing in-memory
  threads are carried over instead of being re-read. See the 2026-07-19
  08:20 changelog entry.

#### L13. ~~`allContextSnapshots` is O(N·M) per watcher/focus/startup check~~ ✅ Resolved
- **Status:** Shipped. Cross-context document discovery
  (`findDocumentContext`, `findDocumentByNormalizedPathAllContexts`) now uses
  WeakMap-memoized `documentId → contextId` and `normalizedPath → contextId`
  indexes keyed by state revision, so repeated lookups within one state are
  O(1) instead of a linear walk over every workspace's docs/tabs. The
  active-context-first winner is preserved, and the index auto-invalidates
  on every mutation (state is replaced immutably). `allContextSnapshots`
  still drives the few callers that genuinely need the full enumeration
  (startup/focus external checks, watched-path sync, tab-removal scan), but
  the per-watcher / per-focus / per-startup-batch hot paths that the audit
  called out no longer re-walk the tree. See the 2026-07-19 08:20 changelog
  entry.

### General / cross-cutting

#### L14. Monolithic `+page.svelte` (2167 lines, ~200 props)
- All `$effect`/`$derived` live in one component; no subtree skipping. The
  root architectural blocker; unblocks L3, L9, L15, L17.
- **Files:** `app/src/routes/+page.svelte`.
- **Complexity: L.**
- **Fix sketch:** Split into per-concern child components so Svelte can skip
  unaffected subtrees on mutation.

#### L15. `snapshot = $derived($appState)` reads the entire state on every mutation
- Cursor moves, zoom, theme — every mutation re-runs every downstream
  derivation that reads `snapshot`.
- **Files:** `app/src/routes/+page.svelte:254`.
- **Complexity: M-L.**
- **Fix sketch:** Replace with fine-grained selectors (`$derived($appState.contexts.activeContextId)` etc.) so downstream derivations do not all
  re-run on unrelated mutations.

#### L16. Inline arrow-function props get new identities each render
- Defeats child prop-equality short-circuits in AppShell's children.
- **Files:** `app/src/lib/components/AppShell.svelte:577-632`.
- **Complexity: M.**
- **Fix sketch:** Hoist stable callbacks (Svelte has no `useCallback`; use
  module-scope or `$derived`-bound handlers).

#### L17. Potential subscription-leak surface from runtime `listen()` registrations
- If `startAppShellRuntime` ever re-runs (HMR / future re-init path), listeners
  would accumulate. Not currently leaking in production.
- **Files:** `app/src/lib/services/appShellRuntime.ts:164-469`.
- **Complexity: S.**
- **Fix sketch:** Guard against double-init.

---

## Resolved (shipped 2026-07-18)

| # | Issue | Commit |
|---|---|---|
| — | Launch waterfall: parallel listeners, parallel JSON reads, background phases, skip backup write | `a8eecca` |
| — | Editor tab keep-alive + workbench multi-host + targeted cache invalidation | `a8eecca` |
| — | VersionControlView git probe memoization across mounts | `a8eecca` |
| — | Defensive chat scroll restore on tab re-entry | `a8eecca` |
| — | Derived-store memoization + `getSnapshot()` subscribe/unsubscribe removal | `a8eecca` |
| #2 | Theme migration no longer re-reads `settings.json` | `4e7a0f1` |
| #4 | Connection keys restored in one store update | `4e7a0f1` |
| #6 | Tab-change session persistence debounced | `4e7a0f1` |
| #16 | Double OpenCode health probe per switch eliminated | `4e7a0f1` |
| #20 | Workspace context lookups indexed via WeakMap | `4e7a0f1` |
| #21 | cycleTheme theme list memoized | `4e7a0f1` |
| L10 | `{#key editor.contextId}` workspace grid remount removed via full context-namespacing | `146d69f` |
| L1 | Bundle code-splitting: lazy pickers + lazy CodeMirror lang packs + manualChunks | (this pass) |
| L12 | `loadWorkspaceSessions` skips thread-file re-reads when in-memory cache is current | (this pass) |
| L13 | `allContextSnapshots` O(N·M) hot paths replaced by WeakMap-memoized context lookup indexes | (this pass) |
| L4 | ChatPanel capability preflight cached per workspace (15s TTL + fingerprint) | (this pass) |
| L5 | `extractSessionTotals` WeakMap-memoized by messages array reference | (this pass) |

---

## Suggested next steps (ordered by impact)

1. **L14** — split `+page.svelte`; unblocks L3, L9, L15, L17.
2. **L7, L8, L16, L17** — small cleanups.
3. **L2** + **L11** — workspace tree/catalog traversal still walks the tree
   twice per switch (and once on launch).
4. **L6** — EditorPaneContent per-keystroke doc lookup + markdown HTML.
5. **Lazy highlight.js** — follow-up to L1; requires an async chat-markdown
   render contract or a fallback-then-rehighlight path.
