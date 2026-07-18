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

#### L1. No code-splitting — heavy initial bundle
- `highlight.js/lib/common` (~2.3 MB, ~40 languages), four CodeMirror language
  packs imported synchronously, and all picker components are in the initial
  bundle.
- **Files:** `app/src/lib/services/chatMarkdown.ts:14`,
  `app/src/lib/editor/editorLanguage.ts:1-5`, `app/src/routes/+page.svelte:1-145`.
- **Complexity: M.**
- **Fix sketch:** Vite `build.rollupOptions.output.manualChunks` plus dynamic
  `import()` for highlight.js, the markdown renderer, and the picker dialogs.
  Each lazy boundary needs a test (chat first render, picker open). The four
  sync CodeMirror language packs can move behind dynamic imports matching the
  existing lazy-pack pattern.

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

#### L4. ChatPanel re-runs capability preflight on every mount
- `runAccessPreflight` + `checkActiveWorkspaceCapabilities` (IPC to the
  sidecar) re-run from scratch on every chat-tab switch because ChatPanel is
  destroyed/recreated (only editor tabs are keep-alive today).
- **Files:** `app/src/lib/components/ChatPanel.svelte:346-371`.
- **Complexity: M.**
- **Fix sketch:** Either extend keep-alive to chat tabs (large — needs the
  same host-coexistence treatment editors got), or cache the preflight result
  per workspace with a short TTL and invalidate on provider/model change.

#### L5. `extractSessionTotals` loops every message on every chat-tab mount
- Re-walks all assistant messages and step parts on each mount.
- **Files:** `app/src/lib/components/ChatPanel.svelte:219`,
  `app/src/lib/ai/chatSteps.ts:234-260`.
- **Complexity: S-M.**
- **Fix sketch:** Memoize the totals keyed by the messages array reference —
  re-derive only when the messages identity actually changes.

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

#### L12. `loadWorkspaceSessions` re-reads every session thread from disk
- Re-reads all priority thread files even when the in-memory cache is current.
- **Files:** `app/src/lib/state/chatStore/sessions.ts:562-739`,
  `app/src/lib/services/chatPersistence.ts:74-106`.
- **Complexity: M.**
- **Fix sketch:** Track a per-root loaded generation; skip the disk read when
  the in-memory `threadsBySessionId` is already current.

#### L13. `allContextSnapshots` is O(N·M) per watcher/focus/startup check
- Linear walk over every workspace's docs/tabs on every external file event.
- **Files:** `app/src/lib/state/appState/contextHelpers.ts:289-364`.
- **Complexity: M.**
- **Fix sketch:** Maintain `filePath → contextId` and `documentId → contextId`
  indexes, updated on context mutations.

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
| L10 | `{#key editor.contextId}` workspace grid remount removed via full context-namespacing | (this pass) |

---

## Suggested next steps (ordered by impact)

1. **L1** — bundle code-splitting. Cuts initial load size materially
   (highlight.js alone is ~2.3 MB).
2. **L12** + **L13** — workspace-switch disk re-reads and linear scans.
3. **L4** + **L5** — chat-tab mount cost (preflight + totals).
4. **L14** — split `+page.svelte`; unblocks L3, L9, L15, L17.
5. **L7, L8, L16, L17** — small cleanups.
