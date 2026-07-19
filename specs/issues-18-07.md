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

#### L3. ~~`+page.svelte` constructs 12 handler/controller factories at module-eval~~ ✅ Resolved
- **Status:** Shipped. The seven AppShell handler bundles (project-tree, layout,
  agent, workspace-context-menu, command, file, editor) now allocate inside
  `AppShellHost.svelte` instead of at page init. The page captures a small
  `AppShellHostApi` via `bind:this` for `onMount` and the retained `$effect`s;
  workbench, session cache, tools, tree controller, and catalogs stay on the
  page. See the 2026-07-19 17:25 changelog entry.

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

#### L7. ~~`buildDocumentByIdMap` rebuilt in two components per emit~~ ✅ Resolved
- **Status:** Shipped. `getDocumentByIdMap` WeakMap-memoizes the id → document
  map by the documents array identity, so every pane + nested TabBar shares one
  Map per documents ref instead of rebuilding 2P times per emit. See the
  2026-07-19 changelog entry.

#### L8. ~~`TabBar` rebuilds visible-tab filter, drag-preview, and sessionTitle Map per emit~~ ✅ Resolved
- **Status:** Shipped. `filterVisibleTabs` and `getSessionTitleById` memoize on
  input array + map identities; `chatSessionIndex` returns the stored index by
  reference. `EditorPaneView` reuses the same visible-tab helper for its count.
  See the 2026-07-19 changelog entry.

#### L9. ~~~5 top-level `$effect`s fire on every tab select~~ ✅ Resolved
- **Status:** Shipped. Persistence split into session vs settings effects; settings
  writes fingerprint persisted fields (excluding cursor). Hydration effect narrows
  to session-id string; tool-close early-returns when no tool is open; access
  monitor skips stop/restart on unchanged boolean; sidecar probe memoized by
  root/mode/url/port/session-active key. Retain-docs effect uses stable open-doc
  ids selector. See the 2026-07-19 17:25 changelog entry.

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

#### L14. ~~Monolithic `+page.svelte` (2167 lines, ~200 props)~~ ✅ Resolved
- **Status:** Shipped. The 2179-line route dropped to 1266 lines (~42%
  reduction). The 10-overlay concern (5 pickers + 3 dialogs + project search +
  workspace context menu) is fully isolated in a new `OverlayHost.svelte`,
  with pure-logic handlers (`overlayHostHandlers.ts`) and a unit-tested
  close-others coordinator (`overlayCoordinator.ts`). The ~370 lines of
  AppShell prop wiring moved into a new `AppShellHost.svelte` wrapper. The
  three cross-cutting `$effect`s that fuse retained snapshot state with
  overlay state stayed on the page but delegate to `overlayHost.api`
  (`isAnyOverlayOpen` replaces the duplicated 10-boolean list;
  `closeAllOnWorkspaceSwitch` / `closeMarkdownOnlyPickers` move the
  picker-close half out of the workspace-switch / markdown-closer effects).
  The three pre-refactor asymmetries (bookmark list not closed on language
  change; sessionList / addMultiple / timeline / workspaceContextMenu not
  closed on workspace switch; projectSearch left open on workspace switch
  with its in-flight search cancelled) are pinned as-is with explicit tests.
  Unblocks L3, L9, L15, L17. See the 2026-07-19 14:50 changelog entry.

#### L15. ~~`snapshot = $derived($appState)` reads the entire state on every mutation~~ ✅ Resolved
- **Status:** Shipped. Monolithic `snapshot` removed from `+page.svelte`.
  New `appStateSelectors.ts` exposes fine-grained `derived(appState, …)` slices
  (`appSettings`, `appEditor`, `appContexts`, `appOpenDocumentIds`, etc.).
  `AppShellHost` receives explicit leaf props instead of the full snapshot;
  imperative paths use `appState.getSnapshot()`. See the 2026-07-19 17:25
  changelog entry.

#### L16. ~~Inline arrow-function props get new identities each render~~ ✅ Resolved
- **Status:** Shipped. AppShell, AppShellHost, and `+page.svelte` hoist stable
  script-level handlers (module-scope noops for fallbacks) so EditorPaneContent
  and siblings no longer receive fresh callback identities each flush — notably
  `onActivePaneElement`, which had been re-firing an `$effect`. See the
  2026-07-19 changelog entry.

#### L17. ~~Potential subscription-leak surface from runtime `listen()` registrations~~ ✅ Resolved
- **Status:** Shipped. `startAppShellRuntime` disposes any prior active cleanup
  before registering new listeners; `setupAppShellMount` uses a `disposed` flag
  so a late-resolving start cleans up immediately instead of leaking. See the
  2026-07-19 changelog entry.

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
| L14 | Monolithic `+page.svelte` split into `OverlayHost` + `AppShellHost` + coordinator | (this pass) |
| L7 | `getDocumentByIdMap` WeakMap shares document map across panes/TabBar | (this pass) |
| L8 | TabBar visible-tab + session-title derivations memoized on input refs | (this pass) |
| L16 | AppShell/AppShellHost/+page inline callback props hoisted to stable handlers | (this pass) |
| L17 | App-shell runtime double-init guard + mount race cleanup | (this pass) |
| L3 | AppShell handler factories moved into AppShellHost + bind:this API | (this pass) |
| L9 | Tab-select effects narrowed/guarded (persistence, hydration, tools, monitor, sidecar) | (this pass) |
| L15 | Monolithic snapshot replaced by appStateSelectors + AppShellHost leaf props | (this pass) |

---

## Suggested next steps (ordered by impact)

1. **L2** + **L11** — workspace tree/catalog traversal still walks the tree
   twice per switch (and once on launch).
2. **L6** — EditorPaneContent per-keystroke doc lookup + markdown HTML.
3. **Lazy highlight.js** — follow-up to L1; requires an async chat-markdown
   render contract or a fallback-then-rehighlight path.
