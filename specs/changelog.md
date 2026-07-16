# Changelog

## 2026-07-16 21:15 — UI audit: moderate border/separator cleanup + improvement roadmaps

- Read-only UI audit (compared to Cursor/Zed Editor) found the dominant visual
  gap to be hairline saturation: 175 instances of `1px solid var(--color-border-subtle)`,
  with the worst clutter from per-item boxing and double delineation rather than
  the main structural panel edges (which already have `surface-1` vs `bg-root`
  contrast to lean on).
- Shipped the **moderate** border/separator cleanup:
  - Removed double delineation in the Git changes list (`GitChangesPanel.svelte`):
    the list had both an outer border and a per-item `border-top`. Dropped the
    outer border + `overflow:hidden`; kept the inter-item divider. Other lists
    (`SessionListPanel`, `GitHistoryPanel`, `GitTagsPanel`) were scanned and do
    not have this pattern.
  - Relaxed per-item boxing in chat messages (`ChatMessageList.svelte`): user
    and assistant messages now use background contrast instead of a full border;
    only stateful messages (system, system-event) keep a self-contained dashed
    border. This also fixed a latent CSS specificity bug where the
    `:not(.chat-message-assistant)` base border overrode the intended accent/dashed
    border-color on user/system messages. Removed a dead
    `.chat-message-streaming:not(.chat-message-assistant)` rule.
  - Removed a redundant `border-bottom` on `.diff-filters` (`DiffViewerPanel`)
    that stacked directly under the `.diff-header` divider.
  - Collapsed three stacked section dividers in the commit detail view
    (`GitCommitDetailPanel`) into one clean divider before the changes block.
  - Unified the duplicated 1px menu-separator implementations
    (`.tab-context-separator`, `.project-tree-context-separator`) into a single
    shared `.ui-rule` utility in `tokens.css` and migrated all call sites
    (`TabBarContextMenu`, `TabBarNearbySubmenu`, `ProjectTreeContextMenu`).
- Structural panel edges, the editor split-grid `gap:1px` trick, and the
  title/tab/status-bar single hairlines were intentionally kept at this tier
  (they mark real boundaries).
- Added two planning roadmaps (no implementation):
  - `specs/ui-improvements-3/` — moderate plans for button/control vocabulary,
    token hygiene (semantic color/type/shadow tokens), Version Control toolbar
    de-densification, and status-bar grouping. 4 execution plans + README index.
  - `specs/ui-improvements-v3/` — directional plan for the aggressive redesign
    tier (structural dividers by surface contrast, unified control scale, chrome
    layer reduction). References the `ui-improvements-3` plans as prerequisites.
- **Validation:** `npm test` passes (283 files, 2973 tests). `npm run check`
  passes with 0 errors and 0 warnings.

## 2026-07-15 20:18 — Themes: duplicate any theme, mode badges, curated additions

- Added a per-row "Duplicate" action in the Themes view that forks any builtin,
  preset, or custom theme into a new editable custom theme seeded from that
  theme's tokens. Previously only the currently active theme could be forked.
  Backed by a new DOM-free `resolveTokensForRef` resolver and a `duplicateTheme`
  state action.
- Added four hand-authored preset themes in a new `curatedThemes.ts`: High
  Contrast (dark), High Contrast (light), Terminal Green, and Terminal Amber.
  These live separately from the auto-generated imported-themes catalog and are
  concatenated into the theme picker and the cycle order.
- Fixed theme-name inconsistency: only the two builtins carried "(Dark)"/"(Light)"
  in their names. Renamed them to plain "Amber"/"Blue" and added a uniform
  dark/light badge to every theme row (manual, light, and dark lists), plus an
  accessible `{name} {mode}` label per row so the two "High Contrast" entries
  stay distinguishable in manual mode.
- Added `.theme-row-duplicate` styling and a tag-spacing rule for rows that
  carry both a mode badge and the existing "custom" tag.
- **Validation:** `npm test` passes (283 files, 2973 tests). `npm run check`
  passes with 0 errors and 0 warnings. Existing `cycleTheme` order tests remain
  green (curated refs appended after imported presets, before customs).

## 2026-07-15 19:15 — M8 Find/replace polish (unified search model + UX)

- Added a unified search query model (`searchQuery.ts`) shared by in-file
  editor search and project-wide search: literal/regex, case-sensitive,
  whole-word, capture-group replacement (`$1`, `$<name>`, `$&`, `$$`), and
  structured validation for invalid regular expressions. The matching engine
  uses `@codemirror/search`'s `RegExpCursor` for both literal and regex
  queries, correctly handling zero-length matches without infinite loops.
- Reworked editor find/replace (`editorSearchOps.ts`, `searchHighlight.ts`)
  to consume `SearchQuery` objects through the full host/domain/runner chain
  (`editor.ts` types, `editorDomainApis`, `editorHostFactory`). Replace-all
  dispatches mapped CodeMirror changes as a single undoable transaction;
  replace-current/replace-and-find-next expand captures from the live
  selection match.
- Aligned project search (`projectSearch.ts`) to the same query model:
  `ProjectSearchMatch` now carries `to`/`length` for regex replacement,
  `searchInProject` validates the query before traversal and returns a typed
  outcome, and `replaceInProjectFile` accepts a `SearchQuery`. Dirty open
  documents remain skipped via the existing `decideReplaceAllForPath` gate;
  clean open buffers are synced via `syncOpenDocumentAfterReplace`.
- Upgraded in-file Find/Replace UI (`FindReplacePanel.svelte`): match-case,
  whole-word, and regex toggles with `aria-pressed` state and tooltips;
  inline regex error display; navigation/replacement disabled until the query
  is valid; query seeded from a non-empty single selection on open;
  responsive width (`clamp(320px, 90%, 480px)`) replacing the fixed 440px;
  preserved Enter/Shift+Enter, F3/Shift+F3, Escape, and Tab focus cycling.
- Upgraded project search UI (`ProjectSearchPanel.svelte`): same query
  toggles and inline regex validation; Search and Replace All disabled on
  invalid query; in-app confirmation dialog summarising file/match counts
  before project replace-all (non-destructive cancellation leaves files
  untouched); search is cancellable via a generation counter on workspace
  switch and panel close so stale results never open.
- Editor tool controller holds `wholeWord`/`regexp` state alongside the
  existing query/replace/case fields.
- **Safety policy:** project replace-all runs through `requestConfirm` and
  reports skipped-dirty and failed counts after replace; on-disk replacement
  never silently clobbers unsaved buffers. Word boundaries use ASCII `\b`
  (documented JS semantics).
- **Validation:** `npm test` passes (282 files, 2960 tests). `npm run check`
  passes with 0 errors. Svelte autofixer reports no issues on touched
  components.
- **`specs/…/m8-1-…` and `m8-2-…-execution-plan.md`** — all tasks `[DONE]`,
  status Done, exit criteria checked. Roadmap marked 9/9 milestones complete.

## 2026-07-15 10:45 — M6 Markdown snippets (model + UX)

- Added a SpecOps-native Markdown snippet catalog (front matter, requirements,
  acceptance checklist, decision record, callout, fenced block, table) with
  pure validation for ids, triggers, lengths, and `${…}` / `${SELECTION}` syntax.
- Persisted `markdownSnippets` settings (enabled built-in ids + user records)
  with normalize-on-load (drop invalid / resolve duplicates) and store CRUD;
  no migration of older formats. Snippet bodies are never logged.
- Wired CodeMirror insertion/completion: tab stops, final cursor, selection
  wrap, indent adaptation, main-cursor-only multi-cursor policy, ephemeral
  sessions cleared on document switch. Non-Markdown hosts report disabled.
- Added unbound `edit.insertSnippet` command + searchable Insert Snippet picker
  (stale host identity rejected) and Settings → Editor → Markdown snippets
  management (enable builtins; add/edit/duplicate/delete user snippets with
  local draft validation and delete confirmation).
- **Validation:** `npm test` passes (281 files, 2917 tests). `npm run check`
  passes with 0 errors. Svelte autofixer reports no issues on touched
  components (suggestions only).
- **`specs/…/m6-1-…` and `m6-2-…-execution-plan.md`** — all tasks `[DONE]`,
  status Done, exit criteria checked.

## 2026-07-15 08:15 — F1.6 Editor and outline edge cases

- Outline publishes are generation-bound: `markdownOutlineHostBinding` rejects
  stale pane/document/generation snapshots; `MarkdownOutlinePanel` clears on tab
  switch and refreshes from the matching host (500ms poll fallback).
- Inactive panes use `pointer-events: none` on the editor surface; pane chrome
  still activates on pointerdown, and focus is blurred when a pane deactivates.
  Find/replace, go-to, and outline remain active-pane-only.
- App-icon batch open notifies the successful open count only; failures and
  cross-window redirects are reported per path.
- Editor session cache retains undo/fold entries across inactive contexts via
  `collectAllOpenDocumentIds` (still LRU-bounded at 32).
- **Validation:** `npm test` passes (279 files, 2902 tests). `npm run check`
  passes with 0 errors. Svelte autofixer reports no issues on touched
  components (suggestions only).
- **`specs/…/f1-6-…-execution-plan.md`** — all tasks `[DONE]`, status Done,
  exit criteria checked.

## 2026-07-14 23:14 — F1.5 Persistence and cross-window safety

- Serialized all `session.json` read-modify-write paths through a shared write
  lock (`sessionWriteLock.ts`) used by session persistence and the open-file
  registry. Concurrent window persists retain both entries; flush awaits the
  write chain. Window snapshots may stamp optional `updatedAt` for diagnostics.
- Cross-window tab merge is ack-based: the source removes the tab and syncs the
  registry only after the target acknowledges adoption. On failure or timeout the
  source keeps the tab and shows a toast.
- New windows no longer hydrate another window’s session by default
  (`DUPLICATE_LAST_SESSION_ON_NEW_WINDOW = false`); missing `windows[windowId]`
  restores empty. Startup external-check cancellation returns the pending drain
  promise; stale document ids are skipped during background drain.
- **Validation:** `npm test` passes (277 files, 2892 tests). `npm run check`
  passes with 0 errors.
- **`specs/…/f1-5-…-execution-plan.md`** — all tasks `[DONE]`, status Done,
  exit criteria checked.

## 2026-07-14 22:48 — D1.6 CI, metadata, accessibility, and maintenance checks

- Expanded the Test workflow into frontend (Vitest on macOS/Windows/Linux plus
  Linux `npm run check`), Rust (`cargo test` on Linux), and Markdown link jobs;
  Node setup now reads `.nvmrc` (24).
- Release workflow validates semver tags (`vMAJOR.MINOR.PATCH` with optional
  prerelease/build) before platform builds; README documents the policy and the
  three version fields to keep in sync.
- Completed `app/package.json` description/repository/homepage/bugs/engines and
  Cargo author/license/description metadata; marked the package private.
- README screenshots now have descriptive alt text; decorative favicon alt stays empty.
- Added `scripts/check-markdown-links.mjs` for clean-clone relative-link and
  anchor checks (skips external URLs and archival `specs/ops/`; blocks public
  docs from linking into untracked `specs/` paths). Documented the command in
  `CONTRIBUTING.md`.
- Cleared the previous 12 `svelte-check` errors and fixed a macOS
  `core.quotepath`/Unicode assertion in Rust git tests so the merge gate is green.
- **Validation:** `npm test` (2886), `npm run check` (0 errors), `cargo test`
  (52), and `node scripts/check-markdown-links.mjs` pass.
- **`specs/docs-1/d1-6-…-execution-plan.md`** — all tasks `[DONE]`, status Done,
  exit criteria checked.

## 2026-07-14 22:10 — D1.5 Documentation accuracy and roadmap freshness

- Updated the public text-editor roadmap to show seven completed milestones and
  two planned milestones; updated the local Fixes v1 roadmap to show four of six
  plans complete without claiming unfinished work.
- Standardized current docs on **Settings → Dev → Enable Chat (beta)**,
  **Settings → Dev → Providers**, and the visible Workspaces settings hierarchy.
  Internal context and tab ids are now identified as implementation terms.
- Corrected the HTTP Chat guide to describe both buffered JSON and streaming
  SSE requests, removed the contradictory “streaming unused” claim, and aligned
  its connection schema, defaults, scoped debug ids, secrets, and source-file
  references with current code.
- Documented `npm ci` for reproducible setup, `npm install` for dependency
  changes, actual colocated test patterns, and the macOS/Windows release versus
  three-platform test-CI and local Linux build distinction.
- Removed stale links to local-only planning files and retained historical
  terminology in earlier changelog entries.
- Updated Chat (beta) recovery/settings copy so Settings paths say
  **Settings → Dev → Providers** / **Debug Provider**, and prefer
  “workspace sessions” over “workspace agents” in current user-facing text.

## 2026-07-14 21:56 — F1.4 Split-pane tab operations

- Session-wide tab discovery now covers every pane for quick-open recency, activity-rail counts, deleted-file cleanup, save handoff, tab transfer, agent-session restore, and missing-tab cleanup. Remaining `getSessionTabs` calls are documented focused-pane operations.
- Tab context-menu bulk close actions use the pane-local tab list that opened the menu. Close Other/Left/Right preserve dirty prompts, missing-tab close stays pane-scoped, and stale context tabs report a notification instead of silently doing nothing.
- Large-file confirmation carries the pane document id through the editor shell, so pending files in inactive panes confirm the correct document with pane-local progress state.
- Cross-pane body drops append using the destination pane tab count. Next/previous tab commands now follow the documented pane-local cycling policy.
- Added split-pane regressions for inactive-pane bulk/missing close, large-file confirmation, destination drop indexing, pane-local cycling, deleted-file cleanup, and window transfer.
- **Validation:** `npm test` passes (277 files, 2886 tests); focused F1.4 suite passes (119 tests). `npm run check` has no new F1.4 errors; 12 pre-existing errors remain in six unrelated files. Svelte autofixer reports no issues or suggestions in the edited components.
- **`specs/…/f1-4-…-execution-plan.md`** — all tasks `[DONE]`, status Done; feature exit criteria checked, with the baseline `npm run check` limitation recorded.

## 2026-07-14 21:40 — Documentation v1 execution roadmap

- Added `specs/docs-1/README.md` and six ordered execution plans covering the complete July 2026 public-documentation audit.
- **D1.1 Public links and specs visibility** — clean-clone link integrity, an explicit tracked/local-only specs policy, and useful roadmap indexes.
- **D1.2 Contributor, agent, and governance policy** — separate human and coding-agent workflows, consolidated repository rules, and public security/conduct/issue/PR channels.
- **D1.3 Information architecture and deduplication** — audience-based navigation, a smaller root README, and one canonical source for repeated setup, beta, and persistence content.
- **D1.4 User guides and technical separation** — non-AI onboarding plus separate user and contributor guides for workspace agents and HTTP chat.
- **D1.5 Accuracy, terminology, and roadmap freshness** — current roadmap status, UI labels, commands, tests, streaming behavior, and platform expectations.
- **D1.6 CI, metadata, accessibility, and maintenance checks** — aligned merge gates, release-tag policy, package/toolchain metadata, screenshot alt text, and clean-clone link validation.
- Recommended order: D1.1 → D1.2 → D1.3 → D1.4 → D1.5 → D1.6.

## 2026-07-14 21:36 — F1.3 Restricted save and context migration

- Restricted Save As and save-on-close handoffs now close and prune the workspace tab before creating the Notepad replacement. Registry ownership, saved content, and disk fingerprints are recorded against the live Notepad document, then claimed for its window.
- Closing a non-active workspace preserves the current context. Closing the active workspace selects the first remaining workspace in persisted order, or Notepad when none remain.
- Restricted Notepad-to-workspace migration now removes the source duplicate and finds/focuses an existing workspace tab across all panes.
- Added regression coverage for saved-file handoff registry/disk identity, active-context selection on workspace close, and inactive-pane migration deduplication.
- **Validation:** `npm test` passes. `npm run check` has no new F1.3 errors; 12 pre-existing errors remain in unrelated files.
- **`specs/…/f1-3-…-execution-plan.md`** — all tasks `[DONE]`, status Done, exit criteria checked.

## 2026-07-14 00:10 — F1.1 Save integrity + F1.2 Context-aware file side effects

Implemented the first two Fixes-v1 execution plans together (they share the file side-effect surface and F1.1 depends on F1.2's context-aware helpers for non-active workspaces). No persisted-data migration or compatibility shim.

- **F1.2-1 Context-aware document lookup and mutation** — New pure helpers in `contextHelpers.ts`: `allContextSnapshots`, `findDocumentContext`, `findDocumentByNormalizedPathAllContexts` (active-context-first search across notepad, chat-http, and all workspaces; document ids are not globally unique so results carry the owning `contextId`). New context-aware store methods in `documentContentSlice.ts` alongside the existing active-context ones (editor-local edits keep using the active-context path): `markDocumentSavedForContext`, `setDocumentDiskStateForContext`, `applyDocumentDiskReloadForContext`, `renameDocumentInContext`. Active-context methods (`markDocumentSaved`, `setDocumentDiskState`, `applyDocumentDiskReload`, `renameDocument`) are unchanged.
- **F1.1-1 Workspace close "Save all" writes to disk** — `workspaceCloseFlow.ts` no longer calls a no-op `markDocumentSaved`; it now persists every dirty document through the real `saveFile`/`saveFileAs` path (mirroring Save / Save All), records the post-write fingerprint, and syncs the open-file registry via the context-aware APIs so a non-active closing workspace is saved correctly. Cancelled save-as or a failed write aborts the close; "Discard & close" still closes without writing.
- **F1.1-2 Project Replace All protects dirty buffers** — New `projectReplaceSync.ts` decides per file whether Replace All may proceed: an open document that is dirty (in any context) is skipped and counted (`skipped N file(s) with unsaved changes`); clean open documents are synced via `applyDocumentDiskReloadForContext` with the post-write fingerprint. `replaceInProjectFile` now returns the post-write `fingerprint` so the sync clears dirty state without flipping the buffer dirty. The skipped count is surfaced in the status string and notification.
- **F1.1-3 Save / watcher feedback loop** — `saveFile`/`saveFileAs` now bracket the disk write with `beginSaveInFlight`/`clearSaveInFlight` (threaded through the external-changes runtime state), and `checkDocumentExternalChangesInner` returns `unchanged` while a save for that path is in flight, suppressing self-echo reloads and dirty prompts in the race window between `writeTextFile` and `recordWriteFingerprint`.
- **F1.2-2 Watch and check across all contexts** — `watchedPathsFromState` now collects file paths from notepad + chat-http + every workspace (with a documented `MAX_WATCHED_PATHS = 500` defensive cap), so the native watcher observes background-workspace files. `runWatcherExternalCheck`, `runStartupExternalChecks`, and `runFocusExternalChecks` iterate all contexts and resolve the owning context via the new lookup helpers; the check/reload/disk-state path applies via context-aware APIs so an inactive-workspace document is reloaded/marked correctly. Inactive-context dirty documents still defer auto-reload per existing policy.
- **F1.2-3 Relocation, inaccessible tabs, prompt staleness, startup cancellation** — `relocateWorkspacePaths.ts` matches the owning workspace by root path (not active id) and applies `renameDocumentInContext`/`setDocumentDiskStateForContext`/tab close to that workspace without requiring it to be active. `inaccessibleFileTabs.ts` searches all contexts for the document id before closing the tab. The external reload prompt re-reads document state after the async dialog and cancels gracefully if the tab was closed, the path renamed, or the context pruned (staleness guard). Background startup checks now hold an `AbortController` (`cancelStartupExternalChecks`, mirroring the established `lineCounter.ts` AbortSignal pattern); the app shell calls it on teardown, and the drain skips document ids pruned since the scan started.
- **Tests** — `workspaceCloseFlow.test.ts` (6), `projectReplaceSync.test.ts` (7), +3 in `contextHelpers.test.ts`, +5 in `externalFileChanges.test.ts` (save-in-flight race, after-save detection, cross-context watcher, cross-context startup, startup-cancel). Updated `fileSystem.test.ts` mock (new `beginSaveInFlight`/`clearSaveInFlight` exports) and `projectFileOps.test.ts` (`replaceInProjectFile` result now carries `fingerprint`).
- **`specs/…/f1-1-…-execution-plan.md`** and **`specs/…/f1-2-…-execution-plan.md`** — all tasks `[DONE]`, status Done, exit criteria checked.
- **Validation:** `npm test` passes (2870 tests, +24 over the 2846 baseline). `npm run check` has no new errors in changed files (12 pre-existing errors elsewhere unchanged). Svelte autofixer: no new warnings.


- Added `specs/fixes-1/` roadmap and six execution plans from the July 2026 cross-cutting bug audit (text editor, workspaces, tabs, file lifecycle; opencode/chat/git excluded).
- **F1.1 Save integrity** — workspace close fake save-all, project Replace All dirty-buffer clobber, save/watcher race.
- **F1.2 Context-aware file side effects** — cross-context document mutation, multi-context watching, relocation/inaccessible cleanup, reload-prompt staleness, startup-check cancellation.
- **F1.3 Restricted save and context migration** — Save As → Notepad document/registry/disk handoff, `closeWorkspace` active-context rule, restricted migration duplicate tabs.
- **F1.4 Split-pane tab operations** — complete `getSessionTabs` → `allTabs` migration, pane-targeted bulk close and large-file confirm, cross-pane drag index, tab-cycling policy.
- **F1.5 Persistence and cross-window safety** — serialized `session.json`/registry writes, ack-based tab transfer, new-window restore policy.
- **F1.6 Editor and outline edge cases** — outline stale-host guard, inactive-pane interaction policy, minor open-path notification fix.
- Recommended order: F1.1 → F1.2 → F1.3/F1.4 (parallel optional) → F1.5 → F1.6.

## 2026-07-13 15:30 — Split-layout reliability

- Fixed restored Notepad/workspace contexts being replaced with a fresh draft when the active split pane was empty but sibling panes still held tabs. Restore now checks the complete layout tab count.
- Made cross-pane tab discovery consistent for file reopening, singleton session/view tabs, file-path routing, external-file watching, inaccessible-file cleanup, window-empty detection, the Notepad rail, and next/previous tab navigation. Existing files and singleton view/session tabs now focus their owner pane rather than duplicating.
- Made ordinary file/view tab activation happen on pointer press, independently of the drag-completion path, so interrupted drag sequences cannot leave a tab unselectable.
- Added status feedback for View → Layout preset changes, including when the new pane begins as an implicit empty draft.
- Added regression coverage for restoring an empty active pane with sibling content, and for focusing existing view/file tabs held in another pane.
- **Validation:** targeted split-layout regressions pass (122 tests).

## 2026-07-12 19:41 — M7 document landmarks (quick heading jump + document-local bookmarks)

- **M7.1-1 Heading-jump command and ranking** — New `app.goToHeading` command (`markdownEdit` availability, category Navigation, palette-visible). **Binding decision:** left palette-only (`{mac:"none",windows:"none"}`) because `Cmd/Ctrl+Shift+O` is owned by `app.toggleMarkdownOutline` and no conflict-free standard binding exists — the plan explicitly permits this. New pure module `picker/headingRanking.ts` reuses the M4.2 `MarkdownHeadingSnapshot` model and the shared `fuzzyRank` engine — **no second heading parser**. Ranks heading text fuzzy (primary) with `h{level}`/`line N` alt texts; empty query preserves document order and marks the active heading (nearest at/above cursor); ties break by fuzzy score → proximity to cursor (by document position) → document order. Duplicate heading labels stay distinguishable via a secondary `H{level} · line {N}` hierarchy label. Added `"app.goToHeading"` to `AppCommandId`, `definitions.ts`, the Edit menu (`appMenuDefinitions.ts`), and `NATIVE_MENU_COMMAND_IDS`. Handler delegates to a new `openHeadingJump?: () => void` seam on `CommandContext` (threaded through `createAppShellCommandHandlers`).
- **M7.1-2 Heading-jump picker and validation** — New `HeadingJumpPicker.svelte` on the shared `SearchablePickerShell` (combobox/listbox, keyboard nav, Enter/Escape, focus restore): renders level badge, highlighted label, hierarchy/line metadata, and a `current` marker on the active section. Enter switches preview→edit (consistent with the outline), calls the existing `host.actions.navigation.jumpToHeading(key)` (unfolds covering folds, reveals, focuses), then closes. New `EditorToolId` `"heading-jump"`. Mounted in the `AppShell.svelte` overlay tail via a new optional `headingJump` prop; wired in `+page.svelte` with ephemeral `headingJumpOpen`/`headingJumpQuery` state. Results derive reactively from `editorWorkbench.getActiveHost()?.queries.markdown.getHeadings()` + selection, polled at 200ms while open (mirrors the outline panel). Mutual exclusion with Quick Open / command palette / bookmark list: opening one closes the others; all close on workspace switch; heading-jump also closes when the active document stops being Markdown.
- **M7.2-1 Bookmark state and markers** — New `editor/editorBookmarks.ts` owns the reserved `landmarks` compartment (previously `[]`). Bookmarks are **ephemeral**: a `StateField<readonly number[]>` storing sorted, deduplicated document positions. CodeMirror's change-mapping keeps each position attached to its line through edits (`mapPos(pos, -1)` biases left so a deleted line's mark lands on the first surviving line); positions collapsing onto the same line are re-deduped each update. Toggle deduplicates multiple selections on the same line (multi-cursor on one line = one flip). Effects: `toggleBookmarkEffect` (per-selection positions), `clearAllBookmarksEffect`, `removeBookmarkLinesEffect`. Gutter (`cm-bookmarkGutter`, ~14px) coexists with line numbers and the M4 fold gutter (CodeMirror stacks gutters); marker is an accessible `<button>` with aria-label/title; click toggles the bookmark on that line. `bookmarkSnapshots()` exposes bounded (≤80 chars), trimmed line previews for the list picker. Documented deletion rule: a fully-deleted bookmarked line's mark maps to the next surviving line (bias-left), never silently vanishing. New `EditorBookmarkActions` (`toggle`/`next`/`previous`/`clearAll`) and `EditorBookmarkQueries` (`list`) on the editor host; flat `EditorCommandRunner` adapters (`toggleBookmark`/`nextBookmark`/`previousBookmark`/`clearBookmarks`); bookmark action names added to `CORE_ACTIONS` for capability. Next/previous unfold covering folds, reveal, and focus; they wrap within the document.
- **M7.2-2 Bookmark commands and navigation** — Five new commands: `edit.toggleBookmark` (`Cmd/Ctrl+F2`), `edit.nextBookmark` (`F2`), `edit.previousBookmark` (`Shift+F2`), `edit.clearBookmarks` (palette-only), `edit.listBookmarks` (palette-only). F2 was otherwise unused in the catalog. All `availability: "document"`, category Edit, palette-visible, with Edit menu entries + `NATIVE_MENU_COMMAND_IDS`. Handlers route toggle/next/previous/clear through `getEditorRunner()`; next/previous surface "No bookmarks." when empty; `edit.listBookmarks` delegates to a new `openBookmarkList?: () => void` seam. New `BookmarkListPicker.svelte` on `SearchablePickerShell` (line number + bounded trimmed preview with highlights; Enter → `goToLine` + focus). Mounted in the AppShell overlay tail via `bookmarkList` prop; wired in `+page.svelte` with ephemeral state and the same mutual-exclusion/switch-close rules as heading-jump.
- **M7.2-3 Validation** — Coverage in `editorBookmarks.test.ts` (17 tests: toggle on/off, multi-line toggle, same-line dedupe across selections, insertion-above mapping, deletion → surviving-line mapping, split/join mapping, clear-all, next/previous wrap with single+multiple marks, bounded preview, live field via toggle effect, multi-cursor toggle dedupe, document-edit mapping) and `headingRanking.test.ts` (9 tests: empty-query order, current-heading mark, hierarchy metadata, fuzzy ranking, duplicate distinguishability, metadata/truncation, proximity tie-break). `editorContracts.test.ts` updated for the `bookmarks` action/query group + capability names. Catalog/handler/keymap coverage: `appViewHandlers.test.ts` (+5 dispatch tests + coverage list), `keymapHandlers.test.ts` (+2 explicit bookmark keymap tests). Runner mocks updated in 4 handler test files + `editorWorkbenchRuntime.test.ts` for the new bookmark adapters/group. **No persisted-data change** — bookmarks live only in `EditorState` (ephemeral, per document view); closing/reopening a file starts with no bookmarks.
- **Tests:** `editorBookmarks.test.ts` (17), `headingRanking.test.ts` (9), plus +7 across contracts/handlers/keymap.
- **`specs/…/m7-1-…-execution-plan.md`** and **`specs/…/m7-2-…-execution-plan.md`** — all tasks `[DONE]`, status Done.
- **Validation:** `npm test` passes (2846 tests). `npm run check` has no new errors in M7 files (12 pre-existing errors elsewhere unchanged). Svelte autofixer reports 0 warnings on touched `.svelte` files (`HeadingJumpPicker.svelte`, `BookmarkListPicker.svelte`, `AppShell.svelte`).

## 2026-07-12 14:36 — M5 typing assistance (auto-close pairs and document-word completion)

- **M5.1-1 Auto-close pairs** — New `editorCompletion.ts` owns the reserved `completion` compartment: `closeBrackets()` + `closeBracketsKeymap` from `@codemirror/autocomplete` (now a direct dependency). Typing an opener (`()[]{}` plus quotes and backticks) inserts the matching closer and leaves the cursor inside; typing an existing closer steps over it; backspace removes an untouched empty pair. Emphasis markers (`*`/`_`) are intentionally not auto-closed — their behavior is not predictable enough for conservative Markdown editing; standard `closeBrackets` covers the predictable pairs. Multi-cursor operations behave identically at each range (CodeMirror applies the command per-selection). The `completion` compartment reconfigures live via `syncCompletion` in `editorViewController` (mirrors `syncFoldGutter`); no editor rebuild on toggle.
- **M5.1-2 Configuration** — New global setting `autoClosePairs` (default **on**) through the full stack: `AppSettingsState`, `defaultSettings`, `applyPersistedSettings`, `setAutoClosePairs` setter, `PersistedSettings` (load normalization + `toPersistedSettings`), `appShellRuntime` load, `appShellEffects` save, and an Editor settings panel toggle. Prop drilled `EditorSurface` → `DocumentEditor` → `MarkdownEditorPane` → `EditorPaneContent` → `AppShell` → `+page.svelte`. Disabled mode restores plain typing immediately (compartment reconfigure drops `closeBrackets`). One typing action remains one undo step (CodeMirror groups the paired insert as a single `input`).
- **M5.2-1 Local document-word completion source** — `localWordSource` in `editorCompletion.ts` suggests words already present in the active document. Privacy-preserving: reads only the current document; never reads other files, AI context, or network sources; never logs document text. Bounded: documents above 500k chars scan a cursor-centered ±100k window plus a 50k head sample instead of the whole document; at most 20k tokens scanned; at most 200 candidates returned. Deduplicates case-aware (keeps first-seen casing), excludes the exact current token, ranks nearer occurrences first then longer words. Unicode-aware (`\p{L}\p{N}_`); ignores single-character tokens and punctuation. Wired via `autocompletion({ override: [localWordSource], … })`.
- **M5.2-2 Trigger, settings, completion UX** — New `edit.triggerCompletion` command (`Ctrl+Space` on both platforms; macOS uses Ctrl not Cmd to avoid the system input-source conflict), category Edit, palette-visible, `availability: "document"`, native Edit menu entry. Routes through the existing global keymap → registry → handler → `getEditorRunner().completeWord()` → `startCompletion(view)`. New `completion` action group (`trigger()`) on `EditorDomainActions` + flat `EditorCommandRunner.completeWord` adapter; added to the capability `CORE_ACTIONS` set. New global setting `autoSuggest` (default **off**, per spec recommendation) toggles `activateOnTyping`; manual `Ctrl+Space` works regardless. `completionKeymap` (Enter accepts, Escape dismisses, arrows move) is always registered and does **not** bind Tab, so Tab keeps indenting via `indentWithTab`. Completion rows and selected state themed with existing tokens (`--color-surface-1`, `--color-border-subtle`, `--color-hover`, `--color-text-primary/secondary`). Completion targets the main cursor (CodeMirror default); documented and tested. Space-key chord support added to `commandBindings.ts` token maps (`Space` ↔ `" "`) so `Ctrl+Space` resolves correctly through the keymap.
- **M5.2-3 Validation** — Coverage in `editorCompletion.test.ts` (23 tests: prefix extraction, repeated terms, dedupe case-aware, exclude exact token, recency/length ranking, single-char skip, 200-candidate cap, large-doc 720k bounding under 500ms, Unicode/code identifiers, Markdown punctuation ignored, `localWordSource` result shape, `completionExtension` builds for all 4 option combinations); `editorViewController.test.ts` (+2: completion compartment reconfigures on setting change, idempotent when unchanged); `settingsSlice.test.ts` (+2: `autoClosePairs`/`autoSuggest` defaults + setter + apply path); `settingsStore.test.ts` (+1: round-trip assertions); `appViewHandlers.test.ts` (+1: `edit.triggerCompletion` dispatches `completeWord`; coverage list updated); `keymapHandlers.test.ts` (+1: `Ctrl+Space` → `edit.triggerCompletion`); `editorContracts.test.ts` (`completion` group + `completeWord` capability); mock runners in 4 handler test files + workbench runtime test updated for `completeWord`.
- **Tests:** `editorCompletion.test.ts` (23), plus +7 across viewController/settings/store/handlers/keymap/contracts.
- **`specs/…/m5-1-…-execution-plan.md`** and **`specs/…/m5-2-…-execution-plan.md`** — all tasks `[DONE]`, status Done.
- **Validation:** `npm test` passes (2814 tests). `npm run check` has no new errors in M5 files (12 pre-existing errors elsewhere unchanged). Svelte autofixer reports 0 warnings on touched `.svelte` files.

## 2026-07-12 13:35 — M4 folding and Markdown outline

- **M4.1-1 Fold extension and commands** — Wired the reserved `fold` compartment via `editorFold.ts` (`codeFolding`, `foldGutter`, `foldKeymap`, accessible fold markers). Global setting `showFoldGutter` (default on; ~14px width) through settings persistence, Editor settings UI, and pane prop drill. Domain actions `folding.*` plus flat runner adapters; commands `edit.toggleFold` / `edit.fold` / `edit.unfold` / `edit.foldAll` / `edit.unfoldAll` in palette, Edit menu, and shortcuts (CM-aligned chords).
- **M4.1-2 Markdown heading folding** — Relies on `@codemirror/lang-markdown` built-in heading fold service (ATX/setext → next equal/higher heading). Pure boundary helpers + foldable integration tests in `markdownFoldBoundaries.ts`; fenced code remains syntax-tree folded.
- **M4.1-3 Fold lifecycle** — Fold state stays in `EditorState` / session cache only (ephemeral; not session JSON). Documented in `editorDocumentSessionCache.ts`. Replacement/lifecycle coverage in fold tests. No new CodeMirror packages (already direct `@codemirror/language`).
- **M4.2-1 Heading model** — `markdownHeadings.ts` extracts ATX/setext via Lezer tree (full parse fallback for large docs), ignores fenced/HTML/comment blocks, stable ordinal keys, active-heading + filter helpers. Host queries `markdown.getHeadings` / `getActiveHeadingKey` / `isHeadingFolded`; `navigation.jumpToHeading` unfolds covering folds then reveals.
- **M4.2-2 Outline UI** — `EditorToolId` `"outline"`; `MarkdownOutlinePanel.svelte` docked beside the editor (filter, indentation, current-section highlight, a11y labels). Commands `app.toggleMarkdownOutline` / `app.focusMarkdownOutline` with `markdownEdit` availability (disabled outside Markdown with reason). Preview-only jump switches to edit mode then focuses the host.
- **M4.2-3 Fold/outline integration** — Outline marks folded headings; jump unfolds target. Scale test: 2,000 synthetic headings under 1.5s budget.
- **Tests:** `markdownHeadings.test.ts`, `markdownFoldBoundaries.test.ts`; catalog/handlers/settings/workbench/contracts updated. Keymap test helper now honors literal Ctrl on macOS.
- **`specs/…/m4-1-…-execution-plan.md`** and **`specs/…/m4-2-…-execution-plan.md`** — all tasks `[DONE]`, status Done.
- **Validation:** `npm test` passes (2786 tests). `npm run check` has no new errors in M4 files (12 pre-existing errors elsewhere unchanged). Svelte autofixer clean on `MarkdownOutlinePanel.svelte` (suggestions only).

## 2026-07-12 10:32 — M3 command catalog and palette UI

- **M3.1-1 Command metadata and availability** — Added pane-aware availability keys (`pane2`/`pane3`/`pane4`) in `domain/commands.ts` and `commands/availability.ts` for `view.focusPane2`–`4`. Added `buildCommandAvailabilitySnapshot()` for pure UI-fact snapshots. New `app.openCommandPalette` definition (`Cmd+Shift+P` / `Ctrl+Shift+P`, palette-excluded with reason).
- **M3.1-2 Searchable palette entries** — Extended `commands/catalog.ts` with effective binding merge via overrides, `PaletteCommandEntry` (`runnable`, `disabledReason`, `displayBinding`), `buildPaletteSnapshot()`, and `refreshPaletteSnapshot()`. New `picker/commandRanking.ts` ranks label-first with category/alias/id alt texts, empty-query category/frequency order, and enabled-before-disabled sorting for both empty and fuzzy queries. Added `formatBindingForPlatform()` in `commandBindings.ts`.
- **M3.1-3 Consistency validation** — Expanded `catalog.test.ts` (duplicate labels/bindings, native menu alignment via `NATIVE_MENU_COMMAND_IDS`, override display, refresh). New `commandRanking.test.ts`. Exported `NATIVE_MENU_COMMAND_IDS` from `appMenuDefinitions.ts`.
- **M3.2-1 Palette controller** — `app.openCommandPalette` handler + `openCommandPalette` seam on `CommandContext` / `createAppShellCommandHandlers`. Ephemeral `commandPaletteOpen`/`commandPaletteQuery` in `+page.svelte`; OR'd into `getOverlayOpen` and `editorTools.isModalOpen`. Opening palette closes Quick Open and editor tools (and vice versa). Reactive availability refresh while open. Edit menu entry added.
- **M3.2-2 Palette UI** — New `CommandPalettePicker.svelte` on `SearchablePickerShell`: label highlights, category, shortcut, disabled reason; close-then-dispatch through `runCommand`. Mounted in `AppShell.svelte` via `AppShellCommandPaletteProps`.
- **M3.2-3 Validation** — Handler/keymap tests for `Meta/Ctrl+Shift+P` and dispatch seam; Svelte autofixer clean on palette component.
- **Tests:** `catalog.test.ts` (+8), `commandRanking.test.ts` (6), `appViewHandlers.test.ts` (+1), `keymapHandlers.test.ts` (+2).
- **`specs/…/m3-1-…-execution-plan.md`** and **`specs/…/m3-2-…-execution-plan.md`** — all tasks `[DONE]`, status Done.
- **Validation:** `npm test` passes (2768 tests). `npm run check` has no new errors in M3 files (pre-existing errors elsewhere unchanged). Svelte autofixer clean on `CommandPalettePicker.svelte`.

## 2026-07-11 22:35 — M1.2 fuzzy file quick open UI

- **M1.2-1 Quick-open command and controller** — New `app.quickOpenFile` command (`Cmd+P` / `Ctrl+P`, `availability: "workspace"`, category `File`, palette-visible) added to `domain/commands.ts`, `commands/definitions.ts`, and `commands/handlers/app.ts`. New `openQuickOpen?: () => void` seam on `CommandContext` (`handlers/types.ts`), threaded through `createAppShellCommandHandlers` in `appShellPageHandlers.ts`. The handler is a thin delegate to the seam (mirrors `app.findInProject`). Native menu entry added to the File menu (`appMenuDefinitions.ts` → `File/Quick Open`, `CmdOrCtrl+P`). The `quickOpenOpen` flag is OR'd into `getOverlayOpen` in `+page.svelte` so the key-routing layer treats the picker as a modal overlay — repeated `Cmd+P` focuses the query input instead of dispatching again (overlay-open guard in `appShellKeyRouting.ts` short-circuits the second press). The flag is also added to `editorTools.isModalOpen` so find/replace/go-to close when the picker opens. The command's `availability: "workspace"` resolves to disabled-with-reason "Open a workspace first." in notepad/chat contexts via the existing pure resolver in `availability.ts`.
- **M1.2-2 File picker** — New `QuickOpenPicker.svelte` component reuses the shared `SearchablePickerShell` + `SearchablePickerOption` + `EditorOverlayHost` (combobox/listbox semantics, `aria-activedescendant` pairing, keyboard nav, Enter/Escape, focus restore). Renders basename as primary text with fuzzy match-range highlights (`<mark>` spans via the new pure `picker/highlightSegments.ts` — merges adjacent/overlapping ranges so the screen-reader label stays contiguous) and the workspace-relative directory as secondary text. Shows loading/error/idle/no-match states and total/scanned counts in a footer with an optional "Refresh" action. The picker owns query + activeIndex state; query changes propagate to the route controller via `onQueryInput` so ranking stays reactive. Mounted in `AppShell.svelte` via a new `AppShellQuickOpenProps` optional prop, gated on `{#if quickOpen}` in the overlay tail. Route controller in `+page.svelte` derives ranked results reactively: `rankFiles(workspaceFileCatalogRegistry.getActiveSnapshot(), quickOpenQuery, { openPaths, recentPaths })` where open/recent paths are derived from the active context via `collectTabOpenPaths`. Selection routes through `openActivePathInPane` targeting the pane captured at invocation (`quickOpenOpenerPaneId`), falling back to the current active pane if the captured pane closed. Large/binary/image candidates follow existing open behavior via the shared gate. The picker closes only on successful handoff; failures (`failed`/`missing`) keep the picker open with a status message.
- **M1.2-3 Validation and UX hardening** — Workspace switch closes the picker atomically (effect in `+page.svelte` watching `activeWorkspaceRoot`/`isChatHttpActive`) so no path from a prior workspace can be opened after a switch. The catalog registry's per-root isolation ensures no cross-workspace candidate leakage. Existing tab focus (not duplicate) is guaranteed by `requestOpenPath`'s `existing` branch in the shared open gate. Picker does not conflict with permission/confirm/askpass overlays (it sits after `ConfirmDialog` in the overlay tail and uses the same `EditorOverlayHost` focus-restore mechanism). The `highlightSegments` pure module is tested independently (9 tests covering empty/single/middle/adjacent/overlapping/unsorted/out-of-bounds/degenerate ranges and full-text preservation).
- **Tests:** `highlightSegments.test.ts` (9: empty ranges, single/middle ranges, adjacent/overlapping merge, unsorted sort, out-of-bounds drop, degenerate drop, full-text preservation); `appViewHandlers.test.ts` (+1: `app.quickOpenFile` dispatch calls `openQuickOpen`; coverage guard updated); `keymapHandlers.test.ts` (+2: `Meta+P` → `app.quickOpenFile`, `Ctrl+P` → `app.quickOpenFile`); `appShellKeyRouting.test.ts` (updated: `openQuickOpen` added to `createAppShellCommandHandlers` test deps).
- **`specs/…/m1-2-…-execution-plan.md`** — all tasks `[DONE]`, status Done.
- **Validation:** `npm test` passes (2715 tests). `npm run check` has no new errors in M1.2 files (12 pre-existing errors elsewhere unchanged).

## 2026-07-11 21:55 — M1.1 workspace file catalog

- **M1.1-1 Catalog lifecycle** — `notifyFilesystemChange` now accepts a `FileWatcherEventKind` (`create`/`remove`/`modify`/`rename`/`other`) threaded end-to-end from the Rust watcher (`file_watcher.rs` `FileChangeKind`, serde lowercase) → `appShellRuntime` → `appShellProjectTreeHandlers` → catalog. `remove` events synchronously drop the matching entry; `create` events add an openable file without a rebuild; everything else falls back to a single debounced rebuild. Events outside the workspace root and events arriving before the initial build is ready are coalesced safely. New `workspaceFileCatalogRegistry.ts` isolates one catalog per normalized root so workspace switches cannot leak candidates and revisiting a root reuses its cached catalog; `disposeRoot` and `dispose` release catalogs on close/teardown. Wired into `+page.svelte` and `syncWorkspaceFileCatalogEffect` alongside the existing single catalog (project search prefers the registry's active snapshot).
- **M1.1-2 File ranking** — New `picker/fileRanking.ts` adapter over shared `fuzzyRank`: builds `FuzzyCandidate<WorkspaceFileEntry>` (basename primary, relative path + directory as alt texts), applies stable recency boosts (open files > recent files > catalog-only, derived from existing `appState` open/recent paths without changing persisted formats), deduplicates by normalized key, bounds the displayed list while reporting `totalMatches`/`scannedCount`/`status`/`truncated` metadata. Empty query orders open → recent → catalog deterministically. `getDiagnostics()` on the catalog exposes content-free counts (entry/error counts, incremental adds/removes, debounced rebuilds).
- **M1.1-3 Diagnostics & integration** — `workspaceFileCatalogDiagnostics.ts` emits content-free perf diagnostics (catalog build/rebuild/rank metrics; entry counts and durations, never paths or contents). New perf metrics `workspaceCatalog.build`/`.rebuild`/`.rank` added to `perfDiagnostics.ts`.
- **Tests:** `fileRanking.test.ts` (14: duplicate basenames, nested/separator-insensitive, exact-over-prefix, recency boosts, empty-query ordering, dedup, bounding, 10k performance budget); `workspaceFileCatalog.test.ts` (+6: incremental add/remove, rename/modify/other debounce fallback, outside-root ignore, during-loading coalescing, content-free diagnostics); `workspaceFileCatalogRegistry.test.ts` (7: per-root isolation, cache reuse, idle snapshot, watcher routing, disposeRoot/dispose, refresh); `workspaceFileCatalog.integration.test.ts` (8: mocked Tauri fs end-to-end enumeration, partial errors, incremental add/remove, burst debounce, mid-build workspace switch cancellation, close/teardown, content-free diagnostics). Rust `file_watcher.rs` (+2 tests: payload serialization with kind, `EventKind` → `FileChangeKind` mapping).
- **`specs/…/m1-1-…-execution-plan.md`** — all tasks `[DONE]`, status Done.
- **Validation:** `npm test` passes (2703 tests). `npm run check` has no new errors in M1.1 files (12 pre-existing errors elsewhere unchanged). `cargo test --lib file_watcher` passes (6 tests). No quick-open UI shipped.

## 2026-07-11 19:20 — M0.6 searchable picker and workspace index foundations

- **M0.6-1 Fuzzy / list navigation** — `picker/fuzzyRank.ts` (contiguous/word-boundary/basename/recent scoring, match ranges, bounded results, empty-query order preserve) and `picker/listNavigation.ts` (arrows, paging, Home/End, clamp, result-change).
- **M0.6-2 Picker shell** — `SearchablePickerShell.svelte` + `SearchablePickerOption.svelte` on `EditorOverlayHost` (combobox/listbox, activedescendant, keyboard/pointer/Enter, focus restore, token + reduced-motion styles). `EditorListboxChrome` is a thin alias. Autofixer-clean.
- **M0.6-3 Command catalog** — `CommandDefinition` gains `category`, `searchTerms`, required `paletteIntent` (+ exclude reason), and `availability` keys. Pure resolvers in `commands/availability.ts`; display catalog in `commands/catalog.ts`. Consistency tests fail when discoverability intent is missing.
- **M0.6-4 Workspace catalog** — Shared `workspaceTraversal.ts` (hidden/heavy dirs, symlinks, partial dir errors, cancellation). `workspaceFileCatalog.ts` with generation guards, debounce invalidation, dispose. Wired via `syncWorkspaceFileCatalogEffect`; project search prefers catalog paths. No quick-open/palette UI shipped.
- **Tests:** fuzzy/list nav, picker shell harness, catalog/availability, workspace catalog cancellation/partial errors, effect memoization.
- **`specs/…/m0-6-…-execution-plan.md`** — all tasks `[DONE]`, status Done.
- **Validation:** `npm test` passes (2668 tests). `npm run check` has no new errors in M0.6 files (pre-existing errors elsewhere unchanged). Svelte autofixer clean on picker components.

## 2026-07-11 18:16 — M0.5 Svelte editor chrome refactor

- **M0.5-1 Runes conversion** — `MarkdownEditorPane.svelte` migrated from `export let`/`$:` to `$props`/`$derived`/`$effect`. `DocumentEditor.svelte` and `FindReplacePanel.svelte` already used runes; find panel no longer touches `appState` (closes via `onClose`).
- **M0.5-2 Markdown lifecycles** — `markdownSplitScrollSync.ts` (generation-guarded split scroll), `markdownPreviewImageFallbacks.ts` (blob URL ownership + stale async guards), `markdownPreviewLinkAttachment.ts` (`{@attach}` link clicks). Pane effects dispose listeners/URLs on document/mode/unmount.
- **M0.5-3 Editor tool controller** — window-local `editorToolController.ts` owns active tool (`find` | `go-to`), find/go-to fields, binding identity, one-tool-at-a-time, modal precedence, and focus restore via workbench. Removed `findReplaceOpen`/`goToOpen` from `appState` and route-local query prop chains through `AppShell`. `EditorOverlayHost.svelte` + `EditorListboxChrome.svelte` provide focus/Escape/listbox foundation for future pickers; `GoToLinePanel.svelte` uses the host.
- **Tests:** `editorToolController.test.ts`, `markdownSplitScrollSync.test.ts`, `markdownPreviewImageFallbacks.test.ts`; command/key-routing handlers updated for `getEditorTools`.
- **`specs/text-editor-parity-v3/m0-editor-foundations/m0-5-…-execution-plan.md`** — all tasks `[DONE]`, status Done.
- **Validation:** `npm test` passes (2621 tests). `npm run check` has no new errors in M0.5 files (pre-existing errors elsewhere unchanged). Svelte autofixer reports no issues on new chrome components.

## 2026-07-11 18:05 — M0.4 CodeMirror extension and action composition

- **M0.4-1 Extension assembly** — `editorExtensions.ts` owns named groups (base, language, highlight, decorations, search, minimap, theme, plus reserved fold/completion/snippets/landmarks seams). Compartments are instance-owned per controller; removed module-global `searchHighlightCompartment`. Documented `BASE_KEYMAP_PRECEDENCE` (indentWithTab → defaultKeymap → historyKeymap). `EditorSurface` remains a thin mount/update/destroy bridge.
- **M0.4-2 Domain actions/queries** — `EditorHost` exposes grouped `actions`/`queries` (`history`, `selection`, `lines`, `navigation`, `search`, `view` / `document`). Implementation in `editorDomainApis.ts` returns typed `EditorActionResult` availability. Flat `EditorCommandRunner` is a thin adapter via `editorHostToCommandRunner` for handlers and find/replace.
- **M0.4-3 Line transactions** — `editorLineTransactions.ts` replaces full-document `withEditorSelection` rewrites with region ChangeSpecs, merged overlapping/adjacent line blocks, multi-selection preservation, and one undo step. Pure `editorLineOps` helpers retained for characterization.
- **Tests:** `editorExtensions.test.ts`, `editorLineTransactions.test.ts`, `editorComposition.test.ts` (per-pane search independence); updated contracts + workbench runtime hosts for grouped APIs.
- **`specs/text-editor-parity-v3/m0-editor-foundations/m0-4-…-execution-plan.md`** — all tasks `[DONE]`, status Done.
- **Validation:** `npm test` passes (2603 tests). `npm run check` has no new errors in M0.4 files (pre-existing errors elsewhere unchanged).

## 2026-07-11 17:16 — M0.3 document-scoped editor sessions

- **M0.3-1 Controller** — `app/src/lib/editor/editorViewController.ts` owns `EditorView` create/destroy, document switching, annotated store/external content sync (`editorTransactions.ts`), scroll flush/restore, and generation-guarded language loads. `EditorSurface.svelte` is a thin mount/update/destroy bridge.
- **M0.3-2 Session cache** — `editorDocumentSessionCache.ts` caches inactive `EditorState` by `{ paneId, documentId }` (independent sessions per pane). Default max **32** entries with LRU eviction; `retainDocuments` / `invalidateDocument` / `invalidatePane` / `clear` for close and teardown. Scroll remains only in `DocumentState.scrollTop`.
- **M0.3-3 Lifecycle** — disk reload notifies via `editorSessionLifecycle.ts` and invalidates cached sessions; restore refuses content-mismatched snapshots so pre-reload text cannot resurrect. Route wires cache context + dispose in `+page.svelte`; `applyDocumentDiskReload` emits the notification.
- **Tests:** `editorViewController.test.ts`, `editorDocumentSessionCache.test.ts`, `editorSessionLifecycle.test.ts`; characterization covers document-scoped A→B→A restore (legacy fixture replace path retained).
- **`specs/text-editor-parity-v3/m0-editor-foundations/m0-3-…-execution-plan.md`** — all tasks `[DONE]`, status Done; session-isolation policy and memory bounds recorded.
- **Validation:** `npm test` passes (2591 tests). `npm run check` has no new errors in M0.3 files (pre-existing errors elsewhere unchanged).

## 2026-07-11 17:08 — M0.2 pane-aware editor workbench runtime

- **M0.2-1 Runtime** — `app/src/lib/editor/editorWorkbenchRuntime.ts` owns route/window-scoped host registration keyed by `{ paneId, documentId, generation }`; rejects stale register/unregister; resolves the active host by pane + document identity. Typed Svelte context via `editorWorkbenchContext.ts`. Host factory `editorHostFactory.ts` adapts the command runner to `EditorHost` actions/queries without exposing `EditorView`.
- **M0.2-2 Prop chain removed** — dropped `bind:editorRunner` / `registerEditorCommandRunner` across `+page`, `AppShell`, `EditorPaneContent`, `MarkdownEditorPane`, `DocumentEditor`, `EditorSurface`. Every mounted text pane registers with the workbench; menu/shortcut/find/go-to/project-search resolve `getActiveRunner()` at call time. Cursor status publishes through runtime subscriptions (inactive panes cannot overwrite the status bar).
- **M0.2-3 Key ownership** — `appShellKeyRouting` distinguishes CodeMirror vs ordinary inputs, ignores IME composition, and wires live modal/picker overlay state from `+page`. App editor commands run while focus is in `.cm-editor`; ordinary inputs stay protected.
- **Tests:** `editorWorkbenchRuntime.test.ts` (stale generation, active-pane/document match, cursor gating, runner adapter); expanded `appShellKeyRouting.test.ts` (CM vs input, overlay, IME).
- **`specs/text-editor-parity-v3/m0-editor-foundations/m0-2-…-execution-plan.md`** — all tasks `[DONE]`, status Done.
- **Validation:** `npm test` passes (2573 tests). `npm run check` has no new errors in M0.2 files (pre-existing errors elsewhere unchanged).

## 2026-07-11 15:52 — M0.1 editor characterization and contracts

- **M0.1-1 CodeMirror fixture** — `app/src/lib/editor/codeMirrorFixture.ts` mounts an `EditorView` in jsdom without a Svelte harness (history, wrap/zoom compartments, muted content replace, search highlight, command-runner factory). Characterization suite `editorCharacterization.test.ts` covers dirty reporting, non-empty selection, muted external replace, wrap/zoom, search marks, destroy cleanup, active-pane `getView` routing, and pane-scoped A→B→A history/selection (documents M0.3 document-isolation target).
- **M0.1-2 host contracts** — `app/src/lib/types/editor.ts` adds SpecOps-native `EditorHostIdentity`, `EditorHost`, `EditorActions`, `EditorQueries`, `EditorActionResult` / capability types, and action-name extension points (selection, fold, completion, snippet, bookmark). Flat `EditorCommandRunner` retained as the migration adapter. Smoke coverage in `editorContracts.test.ts`.
- **M0.1-3 key routing** — `app/src/lib/services/appShellKeyRouting.ts` encodes overlay → editor keymap → permitted global → browser precedence; `createAppShellCommandHandlers.handleKeydown` delegates without behavior change (`overlayOpen` still false until M0.2). Tests cover contenteditable/input guards, always-run find chords, and globals. `SELECT_NEXT_OCCURRENCE_BINDING_DECISION` records M2 `Cmd/Ctrl+D` ownership transfer (no shortcut change now).
- **Deferred gaps (intentional):** live overlay ownership not wired into production keydown; document-scoped sessions (M0.3); CM vs ordinary-input distinction for app editor commands (M0.2).
- **`specs/text-editor-parity-v3/m0-editor-foundations/m0-1-…-execution-plan.md`** — all tasks `[DONE]`, status Done.
- **Validation:** `npm test` passes (2560 tests). `npm run check` has no new errors in M0.1 files (pre-existing errors elsewhere unchanged).

## 2026-07-10 22:05 — Text editor parity v3 roadmap

- Added `specs/text-editor-parity-v3/` with a nine-milestone roadmap for making SpecOps sufficient for routine notes/specs and general text-editing work without pursuing full IDE/editor parity.
- Added the upfront **M0 editor foundations** refactoring milestone: characterization/contracts, pane-aware runtime, document-scoped editor sessions, CodeMirror composition, Svelte editor-chrome modernization, and shared searchable-picker/workspace-index foundations.
- Split fuzzy file open, multiple selections, command palette, folding/Markdown outline, typing assistance, Markdown snippets, document landmarks, and find/replace polish into 22 agent-sized execution plans with complexity scores, dependencies, acceptance criteria, risks, and validation gates.
- Allowlisted `specs/text-editor-parity-v3/**` in `.gitignore` so the roadmap is tracked with the repository.

## 2026-07-10 14:00 — UI / UX milestone M5 (visual polish)

- **M5-1 spacing/typography (bounded)** — `app-shell.css`: `.editor-pane` padding `5px` → `var(--space-3)`. Typography tokens in `buttons.css` (`--font-size-ui` / `--font-size-status`), `EmptyState.svelte`, `ConfirmDialog.svelte`. No app-wide rem sweep.
- **M5-2 shared chrome icons** — new `AddIcon.svelte`, `RefreshIcon.svelte`, `ListIcon.svelte` under `app/src/lib/components/icons/`. Wired into `ActivityRail.svelte` (add + workspace manager), `ProjectPanel.svelte` (refresh), `SessionsSidebar.svelte` (new session/chat button prefix). SVG + `currentColor` approach.
- **M5-3 settings filter (option A)** — `filterSettingsSidebar()` in `settingsDialogUi.ts`; compact search input in `SettingsView.svelte`. Deep-link `openSettingsDialog(tab)` clears filter and still selects the tab. Unit tests in `settingsDialogUi.test.ts`.
- **M5-4 focus editor command** — `view.focusEditor` (`Cmd+Shift+E` / `Ctrl+Shift+E`): toggles project panel + sessions sidebar collapse and closes console; restores panels on second invoke. Handler in `view.ts`; menu entry in `appMenuDefinitions.ts`; `setConsoleOpen` wired through command context. Tests in `appViewHandlers.test.ts`.
- **`specs/improvements/ui-m-5-execution-plan.md`** — all tasks marked DONE; milestone status Done.
- **Validation:** `npm test` passes (2535 tests).

## 2026-07-10 10:04 — UI / UX milestone M4 (discoverability)

- **`app/src/lib/services/versionControlNavigation.ts`** — shared open-VC helper (R5). `openVersionControlForWorkspace` switches to a workspace, gates on git integration, and opens/focuses the singleton `version-control` view tab; notifies when git is off or the target is not a workspace. `openVersionControlForActiveContext` is the command/shortcut entry point.
- **`app.openVersionControl` command** — new app command with default binding `Cmd+Shift+G` / `Ctrl+Shift+G`; registered in command definitions, `app.ts` handler, SpecOps menu, and Keyboard Shortcuts settings list.
- **`app/src/lib/services/workspaceContextMenuController.ts`** — context-menu “Version Control” now delegates to the shared helper and notifies when git integration is disabled (no silent no-op).
- **Workspace Manager → Version Control** — `WorkspaceManagerView.svelte` row action opens VC for that workspace (visible when git column is shown); wired through `EditorPaneContent`, `AppShell`, and `+page.svelte`.
- **Chat empty-state next steps (R5)** — `ChatPanel.svelte` / `ChatMessageList.svelte`: ready empty sessions keep title + short hint; soft setup gaps (`MissingProviderConfig`, OpenCode disabled) show recovery copy and a settings CTA via `EmptyState` actions without duplicating `ChatBlockedState`.
- **Tests:** `versionControlNavigation.test.ts`, `appViewHandlers.test.ts` (command gating + singleton), `WorkspaceManagerView.test.ts` (VC row callback); `commitGraphLayout.test.ts` default-branch checkout fix for `main`-initialized repos.
- **`specs/improvements/ui-m-4-execution-plan.md`** — all tasks marked DONE; milestone status Done.

## 2026-07-10 09:58 — Chrome-less editor view tab pattern moved to backlog

- **`specs/backlog/chrome-less-editor-view-tabs.md`** — new doc for the chrome-less editor view tab pattern, with Version Control as the primary example (`openOrFocusViewTab("version-control")`, git gating, singleton semantics, existing view kinds table).
- **`specs/backlog/README.md`** — index entry for the new doc.
- **`specs/improvements/ui-m-4-execution-plan.md`** — removed inline assumption; M4 now links to the backlog doc instead.

## 2026-07-10 09:55 — Backlog docs reorganized into `specs/backlog/`

- **`specs/backlog/`** — new folder for deferred follow-ups and tech debt; replaces the flat `specs/backlog.md`.
- **`specs/backlog/README.md`** — index linking topic docs and the git post-MVP backlog in `specs/archive/git/backlog.md`.
- **Split topic docs (from former `specs/backlog.md`):**
  - `chat-context-window-budgeting.md`
  - `chat-prompt-summary-quality.md`
  - `chat-estimate-observability.md`
  - `phase-3-5-deferred-appearance-workspace-ux.md`
- **Removed:** `specs/backlog.md`.
- **`docs/architecture.md`** — backlog pointer updated to `specs/backlog/`.

## 2026-07-10 07:45 — UI / UX milestone M3 (in-app confirms)

- **`app/src/lib/services/confirmDialogUi.ts`** — new promise-based confirm API (R4). `requestConfirm({ title?, message, confirmLabel?, cancelLabel?, danger? })` returns `Promise<boolean>`; self-registering dialog host supplies the runner, with a `window.confirm` fallback for minimal mounts/tests. Single-flight policy: a new request displaces a pending one (resolved `false`). Also exports a `confirmDialog(message, danger?)` convenience wrapper and `registerConfirmRunner` for the host.
- **`app/src/lib/components/ConfirmDialog.svelte`** — new self-registering confirm host. Wraps `DialogShell` (M2); registers/unregisters via `$effect`; primary button uses `.btn-primary` or `.btn-danger` (M1) based on the `danger` flag; Cancel uses `.btn-secondary`; Escape/backdrop → cancel (`false`).
- **`app/src/lib/components/AppShell.svelte`** — mounts `<ConfirmDialog />` alongside the other self-registering prompts.
- **Workspace close flow (R4):**
  - `app/src/lib/services/workspaceCloseFlow.ts` — new shared `closeWorkspaceWithConfirm(id, notify)` that drives save / discard / cancel via the in-app confirm (two-step: save-all → discard), preserving the prior save-vs-discard-vs-cancel semantics without native dialogs.
  - `app/src/lib/state/appState/workspaceContextsSlice.ts` — simplified `closeWorkspace(id)` to a pure state transition (removed the callback-based `resolveAction` / `saveAllDirtyDocuments` seam); added `getWorkspaceDirtyDocuments(id)` helper so callers can read dirty docs before deciding.
  - `app/src/lib/commands/handlers/workspace.ts` — `workspace.close` now async, delegates to `closeWorkspaceWithConfirm`.
  - `app/src/lib/services/workspaceContextMenuController.ts` — removed `confirmSaveAll` / `confirmDiscardAll` deps and the pure `resolveCloseWorkspaceAction` / `CloseWorkspaceAction` / `CloseWorkspacePrompts` exports (logic moved into `workspaceCloseFlow`); `closeWorkspace` now awaits the shared flow.
  - `app/src/routes/+page.svelte` — dropped the two `window.confirm`-backed confirm deps passed to the context-menu controller.
- **`app/src/lib/commands/handlers/types.ts`** — `CommandContext.confirm` is now `(message: string) => Promise<boolean>` (was sync `boolean`); `appShellPageHandlers.ts` injects `requestConfirm` instead of `window.confirm`; `fileActions.ts` awaits the confirm in the large-folder open path.
- **Session / chat confirms (R4):**
  - `app/src/lib/services/sessionsSidebarController.ts` — `confirmDeleteSession` is async, uses `requestConfirm` with danger styling.
  - `app/src/lib/components/ChatPanel.svelte` — `deleteSession` uses `requestConfirm` with danger styling.
  - `app/src/lib/services/revertPreviewPrompt.ts` — fallback (no mounted preview dialog) now routes through `requestConfirm` instead of `window.confirm`.
- **Tests:**
  - `app/src/lib/services/confirmDialogUi.test.ts` — new: fallback delegation, runner resolve true/false, per-request forwarding, unregister→fallback, convenience wrapper.
  - `app/src/lib/components/ConfirmDialog.test.ts` — new: confirm/cancel resolve, danger styling, single-flight displacement.
  - `app/src/lib/services/workspaceContextMenuController.test.ts` — removed `resolveCloseWorkspaceAction` suite (logic moved); added `workspaceCloseFlow` + `getSnapshot` mocks.
  - `app/src/lib/commands/handlers/{appViewHandlers,fileHandlers,keymapHandlers,workspaceHandlers}.test.ts` — `confirm` mock signature + override type updated to `Promise<boolean>`; `workspace.close` tests made async with `flushCommandQueue`.
- **`specs/improvements/ui-m-3-execution-plan.md`** — all tasks marked `[DONE]`, status set to Done.

## 2026-07-09 23:39 — UI / UX milestone M2 (empty states + dialog shell)

- **`app/src/lib/components/EmptyState.svelte`** — new shared empty-state primitive (R3). Title + optional description + optional actions slot; `centered` variant fills the pane (Version Control vocabulary) and `inline` variant is a compact block (list/panel vocabulary). Theme text/surface tokens only.
- **`app/src/lib/components/EmptyState.test.ts`** — smoke tests (title-only, title+description+inline, alert role, class hook, null role).
- **`app/src/lib/components/DialogShell.svelte`** — new shared dialog chrome (R4). Fixed backdrop + centered panel, `role="dialog"` / `aria-modal="true"` / `aria-labelledby`, Escape + optional backdrop dismiss, title/body/actions regions, focus move-in on open + restore on close. Presentational shell only (promise-based confirm API is M3).
- **`app/src/lib/components/DialogShell.test.ts`** — smoke tests (closed renders nothing, title/body/aria wiring, Escape dismiss, no-dismiss when `onDismiss` omitted, backdrop dismiss on/off, width + panel class).
- **Empty-state migrations (R3):**
  - `ChatMessageList.svelte` — chat "Start chat" empty → `EmptyState` (inline); removed now-orphaned `.chat-title` / `.chat-hint` / `.chat-empty-state` CSS.
  - `SessionsSidebar.svelte` + `sessions-sidebar.css` — sessions list empty → `EmptyState` (inline).
  - `TodoPanel.svelte` — loading / empty / error todos → `EmptyState` (inline); routed error + cancelled-marker + high-priority colors through `--color-danger` (M1-2 follow-up, removing hardcoded `#e06c75`).
  - `ConsoleLogsPanel.svelte` — "No log entries yet." → `EmptyState` (inline); routed error/warn log colors through `--color-danger` (removing hardcoded `#e06c75` / `#e5c07b`).
  - `WorkspaceManagerView.svelte` — no-workspaces empty → `EmptyState` (centered) with the Add workspace / Add multiple CTAs in the actions slot.
- **Dialog migrations (R4), no behavior change:**
  - `EntryNamePrompt.svelte` — onto `DialogShell` (360px); Enter still submits, Escape cancels; Cancel/OK use shared `.btn` variants; removed duplicated backdrop/panel CSS.
  - `TagDeletePrompt.svelte` — onto `DialogShell` (420px); checkbox + hint body preserved; Cancel/Delete use shared `.btn` variants; `dismissOnBackdrop` suppressed while submitting; removed duplicated backdrop/panel CSS.
- **`specs/improvements/ui-m-2-execution-plan.md`** — all tasks marked `[DONE]`, status set to Done.

## 2026-07-09 22:53 — UI / UX milestone M1 (tokens + shared buttons)

- **`app/src/lib/styles/tokens.css`** — added `--color-text`, `--color-text-muted`, and `--color-surface-3` aliases for light and dark (derived via `color-mix` from existing surface/text tokens; no theme schema changes).
- **`app/src/lib/styles/buttons.css`** — new global button variants (`.btn-secondary`, `.btn-primary`, `.btn-danger`, `.btn-ghost`, `.btn-compact`); `.toolbar-button` shares ghost interaction rules.
- **`app/src/routes/+layout.svelte`** — imports `buttons.css` globally alongside tokens.
- **`app/src/lib/styles/app-shell.css`** — toolbar hover/focus/active moved to shared button stylesheet.
- **Chat** — `ChatBlockedState.svelte` and `chat-composer.css` route danger UI through `--color-danger`; setup/retry/send use shared button classes.
- **Workspace Manager / Add Multiple / Git Changes** — migrated off duplicated `.wm-button` / `.git-changes-*` styles onto shared variants; removed dead scoped button CSS.
- **`specs/improvements/ui-m-1-execution-plan.md`** — all tasks marked `[DONE]`, status set to Done.

## 2026-07-09 21:56 — UI / UX improvement execution plans

- **`specs/improvements/`** — new planning folder for visual consistency and interaction polish (from the UI/UX audit).
- **`ui-ux-requirements.md`** — source of truth (R1–R6): tokens, shared buttons, empty states, dialog/confirm shell, VC/chat discoverability, polish.
- **`ui-m-1` … `ui-m-5` execution plans** — M1 tokens+buttons; M2 empty states+dialog shell; M3 in-app confirms (replace `window.confirm`); M4 VC command/WM entry + chat empty CTAs; M5 spacing/icons/settings polish.
- **`README.md`** — milestone index and suggested order (M1→M2→M3; M4 parallel; M5 last).

## 2026-07-09 21:51 — Public docs refresh (README + docs/)

- **`README.md`** — shortened for a public entry point: clearer product pitch, current feature list (Version Control, minimap, sessions), install/releases link, slim OpenCode quick start; deep provider setup and troubleshooting moved to docs. Planned section no longer lists Git as unimplemented. Added Docs / License footer; stopped linking phase specs from the README.
- **`docs/opencode-integration.md`** — first-session path, provider setup (OpenRouter, GLM Coding Plan), URL `opencode serve` example, and troubleshooting (content relocated from README).
- **`docs/architecture.md`** — fixed broken `providers.md` links → `beta/chat-http-providers.md`; added `git/` / editor / docs vs specs layout; sessions terminology; settings inventory deferred to `settingsDialogUi.ts`; contributor guidance for VC ↔ OpenCode isolation.
- **`docs/README.md`** — new index (users vs contributors; docs vs specs).
- **`CONTRIBUTING.md`**, **`LICENSE`** (MIT) — contributor onboarding and license file matching `package.json`.
- **`docs/beta/chat-http-providers.md`** — corrected relative links after the beta move.
- **`docs/beta/README.md`** — pointer back to the docs index for the non-beta AI path.

## 2026-07-09 19:10 — Editor minimap review fixes

- **`editor/editorMinimap.ts`** — removed `pointer-events: none` from the minimap host so the overlay's click/drag-to-scroll handlers fire (was blocking the exit-criteria jump navigation). Renamed the unused `view` param to `_view`. Switched `showMinimap.compute(["doc"], …)` to `compute([], …)` so the constant config isn't recomputed on every document change.

## 2026-07-09 18:45 — Editor minimap (M1–M5)

- **`app/package.json`** — added the CodeMirror 6 minimap extension dependency.
- **`editor/editorMinimap.ts`** — pure `minimapExtension(enabled)` factory wrapping the `showMinimap` facet (`displayText: "characters"`, `showOverlay: "always"`); returns `null` when disabled so the package renders nothing without remounting the editor. Extracted so the compartment config is unit-testable.
- **`EditorSurface.svelte`** — added a `minimapCompartment`, registered in `EditorState.create` extensions, and reconfigured on `showMinimap` changes (toggled without remount). Themed the minimap gutter border / overlay via `EditorView.theme` using `--color-border-subtle` / `--color-hover` so light/dark both read well.
- **`settingsStore.ts` / `settings.ts` / `settingsSlice.ts` / `appState.ts`** — added `showMinimap: boolean` to persisted settings (`defaultPersistedSettings` + `PersistedSettings`) and `AppSettingsState`; normalize missing/non-boolean values to `true` on load (no migration shim); `setShowMinimap` setter + `applyPersistedSettings` path mirroring `decoratePlaintextSymbols`.
- **`appShellRuntime.ts` / `appShellEffects.ts`** — wired `showMinimap` through settings load and the `syncSettingsPersistenceEffect` save path.
- **Prop plumbing** — `+page.svelte` → `AppShell.svelte` → `EditorPaneContent.svelte` → `MarkdownEditorPane.svelte` → `DocumentEditor.svelte` → `EditorSurface.svelte`. Markdown preview HTML pane is untouched; the minimap renders on the CodeMirror side only.
- **`settings/EditorSettingsPanel.svelte`** — new **Show minimap** toggle under an "Editor" section with SpecOps-native copy; updates open editors immediately via the compartment.
- **Tests** — `editorMinimap.test.ts` (facet config when enabled/disabled); `settingsStore.test.ts` `showMinimap persistence` (default, round-trip, missing-field fallback, non-boolean normalization); `settingsSlice.test.ts` (default + setter + apply path).
- **`specs/minimap/minimap.md`** — exit criteria checked off; status → implemented.
- **`specs/minimap/execution-plan.md`** — Tasks M1–M5 marked `[DONE]`.

## 2026-07-09 18:25 — Editor minimap execution plan

- **`specs/minimap/minimap.md`** — feature spec for a Sublime/VS Code-style CodeMirror minimap (`@replit/codemirror-minimap`), locked decisions, workstreams, and exit criteria.
- **`specs/minimap/execution-plan.md`** — agent task breakdown (M1–M5): dependency wiring, persisted `showMinimap`, settings toggle, theme polish, tests/verification.

## 2026-07-09 13:30 — P7 validation pass and regression guardrails

- **`tabDocumentLookup`** — shared `buildDocumentByIdMap` / `tabDocumentFromMap` used by `TabBar`, `EditorPaneView`, and `watchedPathsFromState` so the P5 O(1) lookup path is unit-testable and consistent.
- **Regression tests** — `optimizationsP7.validation.test.ts` covers hydration concurrency ordering, project-tree root-load memoization across tab churn / workspace transitions, tab lookup parity vs `find`, and watcher sync-key / effect memoization; `tabDocumentLookup.test.ts` covers visibility/title/missing markers and large tab counts.
- **Perf comparison** — `specs/optimizations-p7-validation.json` records before/after host proxies vs P1 baseline and plan targets (priority hydrate, map vs find, watcher collect).
- **`specs/optimizations-plan.md`** — Task P7 marked `[DONE]`; exit criteria checked off.

## 2026-07-09 13:20 — P6 external watcher sync memoization

- **`watchedPathsFromState`** — builds a document-id Map once per call instead of repeated `documents.find` lookups when collecting watched file paths.
- **`externalFileWatcherSyncKey`** — shared watch-flag + paths dedupe key used by runtime sync and the shell effect.
- **`syncExternalFileWatcherEffect`** — memoizes on that key so redundant effect re-runs (and non-path document churn) are no-ops; resets when runtime is not ready.
- **`+page.svelte`** — splits watcher sync into its own `$effect` keyed by `externalWatcherSyncKey` (snapshot read via `untrack`), separate from chat-access / layout effects.
- **Tests** — sync-key stability and effect memoization coverage in `appShellHelpers.test.ts` / `appShellEffects.test.ts`.
- **`specs/optimizations-plan.md`** — Task P6 marked `[DONE]`.

## 2026-07-09 12:18 — P5 tab/render hot-path lookup optimization

- **`TabBar.svelte`** — precomputes a `$derived` `documentById` Map; `tabDocument` uses O(1) map lookup for visibility, titles, tooltips, and aria-labels.
- **`EditorPaneView.svelte`** — same `documentById` / `tabDocument` pattern for `visibleTabCount`.
- **`specs/optimizations-plan.md`** — Task P5 marked `[DONE]`.

## 2026-07-09 10:40 — P4 startup external checks deferral

- **`runStartupExternalChecks`** — checks the active file tab first (blocking), then drains remaining open file tabs in background batches (`mapWithConcurrency`, concurrency 4, batch size 8 with event-loop yields). Dirty buffers still defer without dialogs; individual check failures do not abort the drain.
- **Perf diagnostics** — `startup.phase` labels `startup-external-checks-priority` and `startup-external-checks-background` report priority vs deferred counts/durations.
- **Tests** — active-first ordering, background clean reload, dirty no-dialog, and failure-isolation coverage in `externalFileChanges.test.ts`.
- **`specs/optimizations-plan.md`** — Task P4 marked `[DONE]`.

## 2026-07-09 10:15 — P3 project tree reload trigger narrowing

- **`syncProjectTreeWatcherEffect`** — memoizes root-load and watcher sync keys so tab/session churn that re-invokes the effect is a no-op. Root load runs on workspace-root transition; watcher clears on leave/chat-http and restarts when re-entering an active workspace with `runtimeReady`. Leaving the workspace clears the root memo so re-entry reloads once; chat-http toggles keep the loaded root.
- **`+page.svelte`** — split sidecar and project-tree shell effects so `isSessionTabActive` no longer re-triggers project-tree sync.
- **Tests** — `syncProjectTreeWatcherEffect` coverage in `appShellEffects.test.ts`; controller skip/force coverage in `projectTreeController.test.ts`.
- **`specs/optimizations-plan.md`** — Task P3 marked `[DONE]`.

## 2026-07-09 10:10 — P2 incremental workspace session hydration

- **`chatStore/sessions.loadWorkspaceSessions`** — loads the session index first, hydrates priority/visible session threads before resolving (bounded concurrency via `mapWithConcurrency`, default 6), and defers remaining thread-file reads to a background pass. Draft merge semantics unchanged. Generation tokens cancel stale background hydrates after a newer load for the same scope.
- **`ensureSessionThreadHydrated` / `isSessionThreadHydrated`** — on-demand load for deferred threads when selecting a session or restoring the active tab; shares in-flight reads with the background pass.
- **`restoreWorkspaceSession` / session select / tab sync** — pass open + last-active session ids as priority; ensure the restored/selected thread is hydrated before access preflight.
- **Perf diagnostics** — `workspace.sessionLoad` reports `incremental`, `deferredThreadCount`, and a separate background-hydrate timing; `workspace.restore` includes `prioritySessionCount`.
- **Tests** — incremental hydrate / ensure / draft-preservation coverage in `threadMessages.test.ts`; restore priority wiring in `appShellAgentHandlers.test.ts`; `mapWithConcurrency.test.ts`.
- **`specs/optimizations-plan.md`** — Task P2 marked `[DONE]`.

## 2026-07-09 09:55 — P1 baseline perf diagnostics and success metrics

- **`app/src/lib/services/perfDiagnostics.ts`** — shared lightweight timing helpers (`nowMs` / `elapsedMs` / `logPerfTiming` / `measureAsync`) that emit Console diagnostics with `metadata.kind === "perf"` and stable metric names for startup, workspace restore, session load, project-tree root load, and tab-activation side-effects.
- **Instrumentation** — wired into `appShellRuntime` (startup phases + total), `chatStore/sessions.loadWorkspaceSessions` (index vs thread hydrate split), `restoreWorkspaceSession`, workspace-switch restore in `appShellEffects`, `loadProjectTreeRoot`, `onTabActivated`, and the tab/workspace shell effect in `+page.svelte`.
- **`specs/optimizations-plan.md`** — Task P1 marked `[DONE]`; documented p50/p95 success thresholds and how to filter/reproduce timings.
- **`specs/optimizations-baseline.json`** — before-change baseline for a small workspace (`~/Documents/notes`) and a large workspace (`~/Projects/Unity-AI-Hub`), plus serial session-hydration IO proxies.
- **Tests** — `perfDiagnostics.test.ts`; existing app-shell handler/effect tests still pass.

## 2026-07-08 23:00 — Add app performance optimization execution plan

- **`specs/optimizations-plan.md`** — new execution plan for startup, tab switching, and workspace switching optimizations using the existing phase-plan template structure. Includes assumptions, risk profile, task breakdown (P1–P7), dependencies, acceptance checklists, and exit criteria focused on incremental session hydration, project-tree trigger narrowing, startup external-check deferral, tab hot-path lookup optimization, and watcher-sync memoization.

## 2026-07-08 13:50 — New file/folder/rename popup no longer covers the whole app

- **`components/EntryNamePrompt.svelte`** — the shared entry-name prompt (used by New File / New Folder / Rename from the project tree, plus git branch/stash/tag naming) rendered a full-screen `position: fixed` backdrop with a 76%-opaque `--color-surface-overlay` background, which visually hid the entire app behind a near-solid layer while the small naming popup was open. The backdrop element is kept (it still captures outside-clicks to cancel and centers the dialog), but its background is now `transparent` so only the popup is visible.

## 2026-07-08 12:35 — Version Control settings section

- **`domain/settings.ts`** — new `GitIntegrationSettings` with master `enabled` toggle plus `autosaveBeforeOperations`, `showProjectTreeBadges`, and `showWorkspaceManagerGitColumn` (all default on).
- **`services/gitIntegrationSettings.ts`** — normalize/defaults and helper predicates for gating.
- **`services/settingsStore.ts`**, **`state/appState/settingsSlice.ts`**, **`appShellRuntime.ts`**, **`appShellEffects.ts`** — persist and load `gitIntegration`; `setGitIntegrationEnabled` / `updateGitIntegrationSettings` close all `version-control` tabs across workspaces and drain in-flight git subprocesses when disabled.
- **`git/gitRun.ts`**, **`git/gitIntegrationGating.ts`** — hard-stop `runGit` / `checkGitAvailable` when integration is off; new `drainGitCommands()` IPC wrapper.
- **`src-tauri/src/git.rs`**, **`src-tauri/src/lib.rs`** — expose `drain_git_commands` Tauri command.
- **`components/settings/VersionControlSettingsPanel.svelte`**, **`services/settingsDialogUi.ts`**, **`SettingsView.svelte`** — top-level **Version Control** settings tab with master toggle, git binary info probe, and sub-option toggles.
- **`AppShell.svelte`**, **`workspaceContextMenuController.ts`**, **`EditorPaneContent.svelte`**, **`documentTabsSlice.ts`** — hide Version Control menu entry and block tab open/render when disabled.
- **`fileStatusTracker.ts`**, **`workspaceManagerGitColumn.ts`**, **`WorkspaceManagerView.svelte`** — gate background git probes and hide the Workspace Manager git column per settings.
- **VC panels** — wire autosave-before-git setting into `prepareWorkspaceForGitOperation`.
- **Tests** — `gitIntegrationSettings.test.ts`; extended `gitService.test.ts`, `documentTabsSlice.test.ts`, `fileStatusTracker.git.test.ts`, `workspaceManagerGitColumn.test.ts`, `settingsDialogUi.test.ts`.

## 2026-07-07 18:10 — Make local git writes drainable and recover stale locks

Follow-up to the earlier index.lock fix. Two remaining gaps caused locks to survive even after quitting SpecOps, and left no recovery for locks from other sources:

- **`app/src/lib/git/gitRun.ts`** — local write operations (`add`, `commit`, `restore`, `checkout`, `stash`, `tag`, `branch` mutating, `config` set, `init`) were running on the non-registered Rust `.output()` path because they had no `commandId`. That made them invisible to the app-exit drain — quitting mid-`add`/`commit`/`stash` orphaned the child and its `.git/index.lock`. `runGit` now auto-registers write ops (assigns a `commandId` + local timeout) so the exit drain can reap them; read-only commands (`status`, `diff`, `log`, `show`, `rev-parse`, listings) stay on the fast non-registered path (registering them caused the "stuck on loading" probe bug). A new `isWriteGitCommand` classifier distinguishes the two, including the listing-vs-mutating cases for `branch`/`tag`/`stash`/`config`.
- **`app/src/lib/git/gitWorkingTree.ts`** — `createCommit` now auto-assigns a `commandId` + `timeoutMs` for the `git_commit_with_message` IPC (previously only forwarded when the caller passed one), so commits are drainable on exit.
- **`app/src-tauri/src/git.rs`** — new `remove_stale_index_lock` Tauri command that best-effort removes `<repo_root>/.git/index.lock`, but **refuses when an in-flight SpecOps git command for that repo is registered** (the lock may be legitimately held). This is the recovery path for locks orphaned by a crash, force-quit, or an external writer (e.g. the OpenCode sidecar) — it never clobbers a lock a tracked process owns. `GitCommitRequest` gained a `timeout_ms` field so the commit path can be registered with a deadline.
- **`app/src/lib/git/gitRun.ts`** — the index.lock retry loop now calls `remove_stale_index_lock` on the first failure before retrying, so a genuinely stale lock is cleared and the retry succeeds instead of failing all 3 attempts and telling the user to delete the file manually.
- **`app/src-tauri/src/lib.rs`** — register the new `remove_stale_index_lock` IPC command.
- **`app/src/lib/git/types.ts`** — `RemoveStaleIndexLockResponse` / `RemoveStaleIndexLockOutcome` types.
- **Tests** — Rust: `remove_stale_index_lock` removes an orphaned lock, reports `absent` when none exists, and refuses (`busy`) while a command for the repo is active. TS: updated `gitRun`/`gitService` assertions for the new `commandId`/`timeoutMs` payload fields and the `remove_stale_index_lock` retry call.

## 2026-07-07 11:30 — Fix `.git/index.lock` left behind by git integration

The git integration frequently left a stale `.git/index.lock` behind, blocking all other git tools (and the app's own retries). Three root causes, all in the Rust backend:

- **`app/src-tauri/src/git.rs`** — `terminate_child_process` used `child.kill()` (SIGKILL on Unix), so a cancelled or timed-out git write (`commit`, `pull` with stash/merge, `stash`, `add`, `restore --staged`) never got to release `.git/index.lock` or roll back partial state. Replaced with `terminate_child_process_gracefully`: on Unix it sends SIGTERM (via the new `nix` dependency) and waits a 1.5s grace window for git to clean up, escalating to SIGKILL only if still alive; on Windows it keeps `TerminateProcess` (no graceful option). After the child is reaped it best-effort removes `<repo_root>/.git/index.lock` — safe because removal fails atomically if the lock is still held by a live process (e.g. the OpenCode sidecar or an external tool), so it never clobbers a lock a running process depends on.
- **`app/src-tauri/src/git.rs`** — `ActiveGitCommand` now carries the `repo_root` so the cleanup knows which lock to target; threaded through `register_active_git_command`, the cancel path, the timeout path, and the duplicate-command-id guard.
- **`app/src-tauri/src/git.rs`** — new `drain_all_active_git_commands()` terminates and reaps every in-flight registered git command (gracefully) and clears the registry; called from `lib.rs` `RunEvent::ExitRequested` so quitting the app while a git write is mid-flight no longer orphans a child and its lock.
- **`app/src-tauri/Cargo.toml`** — add Unix-only `nix` crate (`signal` feature) for SIGTERM.
- **`app/src-tauri/src/lib.rs`** — call `git::drain_all_active_git_commands()` in `ExitRequested` alongside the existing sidecar stop.
- **Git unit tests** — new regression tests: cancelling a registered command removes its repo's stale `index.lock`; `drain_all_active_git_commands` terminates children and empties the registry. Also fixed pre-existing broken test struct literals (`RunGitRequest` / `GitCommitRequest` missing `#[serde(default)]` fields) that prevented the Rust test suite from compiling, and serialized registry-mutating tests via a shared mutex so the global `GitCommandRegistry` isn't observed across parallel tests.

Out of scope (deliberately): the TS-side `index.lock` retry loop in `gitRun.ts` is unchanged — it remains useful for transient contention and now rarely sees stale locks since the backend cleans them. No coordination with the OpenCode sidecar's independent git writes.

## 2026-07-07 08:20 — Fix Workspace Manager freezing the whole app on open

- **`WorkspaceManagerView.svelte`** — the git-column load `$effect` triggered Svelte's `effect_update_depth_exceeded` (an infinite update loop) because `loadGitCellsForWorkspaces` read the `gitCellsByPath` state synchronously inside the effect while also writing it, registering a self-dependency. The loop jammed the Svelte runtime for the whole component tree: every click across the app (sidebar mode-switch, tab close, ⚙ settings, console toggle) silently failed, while native OS dialogs (Add workspace) still worked because they bypass JS reactivity. Reads of `gitCellsByPath` inside `loadGitCellsForWorkspaces` are now wrapped in `untrack(...)` so the effect depends only on `workspaces`.
- **`WorkspaceManagerView.test.ts`** — new component-mount regression test asserting the view mounts without looping and that the ⚙ Settings button click reaches its handler.

## 2026-07-06 22:20 — Add "Close Tabs to the Left" context-menu action

- **`tabHelpers.ts`** — new `tabIdsToCloseToLeftOf` pure helper (mirrors `tabIdsToCloseToRightOf`, slicing `0..contextIndex`).
- **`closeTabFlow.ts`** — new `closeTabsToLeftWithUnsavedPrompt` that prompts for unsaved changes before bulk-closing left-side tabs; the context tab stays selected.
- **`tabContextMenuActions.ts`** — new `canCloseTabsToLeft` enabled-flag and `closeTabsToLeftWithPrompt` handler; registered on the handler factory.
- **`TabBarContextMenu.svelte`** — new "Close Tabs to the Left" menu item placed immediately before "Close Tabs to the Right".
- **`documentTabsSlice.ts`** — parallel synchronous `closeTabsToLeft` appState action.
- Tests extended across `closeTabFlow.test.ts`, `tabContextMenuActions.test.ts`, and `documentTabsSlice.test.ts`.

## 2026-07-06 02:06 — Fix editor grid/row layout equal sizing

- **`editorLayout.ts`** — `effectiveLayoutSlots` validates stored `slots` against pane count and layout kind; stale geometry (e.g. single-row slots with four panes) no longer renders extra panes in implicit grid rows that collapse to thin strips.
- **`EditorGridLayout.svelte`** — row track count follows the highest placed pane so every layout group gets an explicit `minmax(0, 1fr)` row.
- **`editorLayoutSlice.ts`** — pane focus by slot uses `effectiveLayoutSlots` for reading order.

## 2026-07-06 02:00 — Silence Rollup `@__PURE__` build warnings

- **`emptyCollections.ts`** — shared `emptySet` / `emptyMap` / `emptyWeakSet` factories for Svelte prop defaults and component init (inline `new Set()` / `new Map()` / `new WeakSet()` triggered Rollup annotation warnings).
- **Project tree / workspace / session components** — use collection factories instead of inline `new` in `$props()` and `export let` defaults.
- **`MarkdownEditorPane.svelte`** — use collection factories and `.clear()` for blob URL tracking; replace `{#if markdownEnabled}` mode bar with `hidden={!markdownEnabled}` to avoid an SSR `@__PURE__` placement bug on bare prop `{#if}` blocks.

## 2026-07-06 01:52 — Fix version control probe stuck on loading

- **`gitRun.ts`** — pass `commandId` and `timeoutMs` only for cancellable/remote git commands; local probe/status commands use the fast non-registered Rust path again. Remote commands still auto-assign `commandId` via `runRemoteGit`.
- **`VersionControlView.svelte`** — probe generation guard so aborted stale probes do not leave the view stuck on "Checking git repository…".

## 2026-07-06 01:48 — Restore post-merge git IPC and error display fixes

- **`gitRun.ts`** — restore `{ request: … }` wrapping for `run_git`; export `runGitInvokeArgs` / `gitCommitInvokeArgs`.
- **`gitWorkingTree.ts`**, **`gitAskpass.ts`** — same `{ request: … }` wrapping for commit and askpass commands.
- **`gitErrorUi.ts`** — format typed `invalidPath` / `notARepository` errors; include non-command git errors in diagnostic stderr extraction.
- **`VersionControlView.svelte`** — probe/branch/init errors use `formatGitErrorPrimaryMessage`; failed probes log to the app console.
- **`fileStatusTracker.ts`**, **`workspaceManagerGitColumn.ts`** — readable git error text in diagnostics.
- **Git unit tests** — invoke expectations and integration mock unwrap `request`.

## 2026-07-06 01:44 — Silence dev build warnings

- **`app/src-tauri/src/git.rs`** — gate test-only `execute_git` / `execute_git_with_options` helpers with `#[cfg(test)]`.
- **`ChatModePicker.svelte`** — wrap `Select` in a scopable container (matches `ChatConnectionPicker`) to clear vite-plugin-svelte global-styles warning.

## 2026-07-06 01:40 — Fix post-merge Rust compile error

- **`app/src-tauri/src/git.rs`** — mark `child` mutable in `register_active_git_command` so duplicate command-id cleanup can terminate the orphan process.

## 2026-07-05 06:26 — Git integration low-priority polish

- **`gitRepo.ts`** — `checkoutBranch` passes branch name after `--` and rejects empty names.
- **`gitTagsStash.ts`** — `deleteLocalTag` validates ref names via `validateGitRefName`.
- **`repositoryStatusSummary.ts`** — probe failures throw typed `GitCommandError` instead of generic `Error`.
- **`workspaceManagerGitColumn.ts`**, **`WorkspaceManagerView.svelte`** — git column error cells expose `{ text: "Git error", message }` with tooltip on the message.
- **`versionControlProbe.ts`** — after `git init`, sets local `user.name` / `user.email` when missing so commits work without global config.
- **`app/src-tauri/src/git.rs`** — allow `config` subcommand for local identity setup.
- **`app/src-tauri/src/git_askpass.rs`** — Windows askpass script writes via PowerShell `WriteAllText` (env var) instead of `echo` for special characters.
- **`gitDiagnosticSanitize.ts`**, **`gitRun.ts`** — redact credentials in diagnostic stderr logs (assignments, Authorization header, URL userinfo).
- **`fixtures/git-branch-vv.txt`**, **`gitParse.test.ts`** — branch parser edge-case fixtures.
- **Tests** — checkout `--` argv, invalid tag delete, init local identity, workspace error cell, sanitizer unit tests.

## 2026-07-05 06:16 — FIX-14: Git integration polish

- **`gitParse.ts`** — hash-anchored `parseBranchVvLine` parsing for branch names with symbols, dots, or spaces outside app validation.
- **`gitParse.test.ts`** — branch name edge-case unit tests.
- **`types.ts`** — `COMMIT_LOG_PAGE_SIZE` (500) and `MAX_COMMIT_LOG_LIMIT` (5000) for history pagination.
- **`GitHistoryPanel.svelte`** — **Load more commits** button with scroll-position preservation and selection kept on append; cap at 5000 commits.
- **`gitStatusFormat.ts`**, **`GitChangesPanel.svelte`**, **`GitTextDiffView.svelte`** — unstaged diff subtitle **(vs last commit)** plus help tooltip explaining HEAD-based semantics (not index-based).
- **`gitStatusFormat.test.ts`** — subtitle and help text tests.
- **`specs/git/execution/fixes/fix-14-git-integration-polish.md`** — marked `[DONE]` (14a–14f; 14d–14f completed in prior hardening pass).

## 2026-07-05 05:40 — Git integration hardening (review follow-up)

- **`app/src-tauri/src/git.rs`** — fail fast when `repo_root` is missing; argv subcommand allowlist; strip blocked `GIT_*` env overrides; 16 MiB stdout/stderr cap; fix duplicate `commandId` registration (terminate orphan child, do not unregister in-flight command).
- **`app/src-tauri/src/git_askpass.rs`**, **`gitRemoteEnv.ts`** — SSH uses `StrictHostKeyChecking=yes` instead of `accept-new`.
- **`gitRun.ts`** — local git ops get 5-minute default timeout and auto `commandId`; retry on `.git/index.lock` (3 attempts).
- **`askpassPrompt.ts`** — queue concurrent credential prompts instead of silently cancelling.
- **`types.ts`** — Windows drive-letter normalization for git queue keys.
- **`gitTagsStash.ts`**, **`VersionControlView.svelte`** — `createStash` returns resolved stash ref for pull stash-and-restore.
- **Tests** — Rust validation tests; askpass queue, index.lock retry, Windows queue-key tests; updated invoke expectations; fix `gitService.test.ts` `expect.objectContaining` syntax.

## 2026-07-04 14:52 — FIX-12 & FIX-13: Stash panel UI and Windows git PATH fallback

- **`GitStashesPanel.svelte`**, **`VersionControlView.svelte`** — new **Stashes** section tab listing stash ref, date, and message; apply, drop, and create actions with bare-repo read-only mode.
- **`LocalChangesStashApplyPrompt.svelte`**, **`localChangesStashApplyPrompt.ts`** — dirty-tree apply dialog (Cancel, Keep changes, Stash and continue) with pre-git autosave.
- **`StashDropPrompt.svelte`**, **`stashDropPrompt.ts`** — drop-stash confirmation dialog.
- **`gitTagsStash.ts`**, **`gitService.ts`** — `dropStash` with typed not-found errors.
- **`versionControlRefresh.ts`** — `stash` mutation scope for VC refresh after stash operations.
- **`app/src-tauri/src/git.rs`** — `resolve_git_binary()` with Windows fallback paths (`Program Files`, `Program Files (x86)`, `LocalAppData`); optional `resolvedPath` on `GitAvailableResponse`.
- **`types.ts`**, **`gitInstallHints.ts`** — optional `resolvedPath` field; Windows install hint mentions default-location discovery.
- **Tests** — `dropStash` unit tests in `gitService.test.ts`; Rust tests for PATH resolution and Windows candidate order.
- **`specs/git/manual-test-checklist.md`** — stashes section manual checks.
- **`specs/git/execution/fixes/fix-12-stash-panel-ui.md`**, **`fix-13-windows-git-path-fallback.md`** — marked `[DONE]`.

## 2026-07-04 14:38 — FIX-10 & FIX-11: gitService modularization and porcelain v2 status

- **`gitRun.ts`**, **`gitRepo.ts`**, **`gitHistory.ts`**, **`gitWorkingTree.ts`**, **`gitRemotes.ts`**, **`gitTagsStash.ts`**, **`gitErrors.ts`** — split `gitService.ts` (~1200 lines) into focused modules; largest module under ~250 lines; no circular imports.
- **`gitService.ts`** — thin re-export barrel preserving the stable import path and public API.
- **`gitParse.ts`** — `parseStatusPorcelainV2Z()` for NUL-delimited porcelain v2 records (ordinary, rename, unmerged, untracked); v1 parser retained for `-sb` tail parsing and regression.
- **`gitWorkingTree.ts`** — `queryWorkingTreeStatus` and `isWorkingTreeDirty` now invoke `git status --porcelain=v2 -z`.
- **`fixtures/git-status-porcelain-v2-z.txt`** — v2 fixture equivalent to the v1 porcelain sample.
- **Tests** — extended `gitParse.test.ts` (v2 unit + integration) and `gitService.test.ts` (v2 argv); full git vitest suite passes.
- **`specs/git/execution/fixes/fix-10-gitservice-modularization.md`**, **`fix-11-porcelain-v2-status-parsing.md`** — marked `[DONE]`.

## 2026-07-04 14:15 — FIX-08 & FIX-09: Pull dirty-tree UX and git cancellation/timeout

- **`LocalChangesPullPrompt.svelte`**, **`localChangesPullPrompt.ts`** — dirty-tree pull dialog with Cancel, Keep changes, and Stash and pull options.
- **`VersionControlView.svelte`** — pull flow offers stash-and-pull with independent stash/pull/apply failure toasts; pre-git autosave unchanged.
- **`app/src-tauri/src/git.rs`** — optional `timeoutMs` on `run_git`; `timedOut` on `RunGitResponse`; polling wait with timeout; commit accepts `commandId`.
- **`gitService.ts`**, **`types.ts`** — `REMOTE_GIT_OPERATION_TIMEOUT_MS` (10 min) for remote ops; `GitCommandTimedOutError`; `createCommit` accepts cancellable `commandId`.
- **`GitChangesPanel.svelte`** — commit registers command id for toolbar Cancel.
- **`gitErrorUi.ts`** — timeout error messaging.
- **Tests** — Rust timeout test; extended `gitService.test.ts`, `gitCancel.test.ts`, `gitErrorUi.test.ts`.
- **`specs/git/manual-test-checklist.md`** — dirty-tree pull and cancel/timeout flows.
- **`specs/git/execution/fixes/fix-08-pull-dirty-tree-ux.md`**, **`fix-09-cancellation-and-subprocess-timeout.md`** — marked `[DONE]`.

## 2026-07-04 14:00 — FIX-06 & FIX-07: Per-repo git queue and status performance

- **`app/src/lib/git/gitCommandQueue.ts`** — shared per-repository FIFO queue via `enqueueGitCommandForRepo()`; unrelated repos run concurrently.
- **`app/src/lib/git/gitService.ts`** — `runGit` and `createCommit` enqueue by normalized repo root; `checkGitAvailable()` cached for 60s with in-flight dedupe and `resetGitAvailabilityCacheForTests()`.
- **`app/src/lib/git/workspaceManagerGitColumn.ts`** — removed duplicate global queue; bulk column refresh loads workspaces in parallel (per-repo queue still serializes same repo).
- **`app/src/lib/git/repositoryStatusSummary.ts`** — one `git status -sb` call (plus detached `rev-parse --short HEAD`) replaces prior 3–4 sequential subprocesses per summary.
- **`app/src/lib/git/gitParse.ts`** — `parseStatusShortBranchHeader()` for `-sb` branch/tracking lines.
- **`app/src/lib/git/gitErrorUi.ts`** — actionable message for `.git/index.lock` / unable-to-create lock stderr.
- **Tests** — `gitCommandQueue.test.ts`; extended `gitService.test.ts`, `gitParse.test.ts`, `repositoryStatusSummary.test.ts`, `workspaceManagerGitColumn.test.ts`, `gitIntegration.test.ts`, `gitErrorUi.test.ts`.
- **`specs/git/execution/fixes/fix-06-per-repo-git-command-queue.md`**, **`fix-07-git-probe-and-status-performance.md`** — marked `[DONE]`.

## 2026-07-04 13:45 — FIX-04 & FIX-05: Ahead/behind errors and workspace git column refresh

- **`app/src/lib/git/gitService.ts`** — `isNoUpstreamAheadBehindError()` distinguishes missing upstream from real git failures; `queryAheadBehind` throws `GitCommandError` for lock/conflict errors instead of returning null.
- **`app/src/lib/git/repositoryStatusSummary.ts`** — catches ahead/behind failures, logs diagnostics, and exposes optional `aheadBehindError` while preserving branch/dirty summary.
- **`VersionControlView.svelte`** — branch header stays ready when tracking query fails; shows subtle “Tracking unavailable” with error tooltip.
- **`app/src/lib/git/workspaceManagerGitColumn.ts`** — diagnostic logging on probe failure; `subscribeWorkspaceGitColumnAutoRefresh()` debounces VC mutation invalidation (~300ms).
- **`WorkspaceManagerView.svelte`** — subscribes to git column auto-refresh after VC mutations; tooltip reflects tracking load failures.
- **Tests** — extended `gitService.test.ts`, `repositoryStatusSummary.test.ts`, `workspaceManagerGitColumn.test.ts`.
- **`specs/git/execution/fixes/fix-04-ahead-behind-error-handling.md`**, **`fix-05-workspace-manager-git-column-refresh.md`** — marked `[DONE]`.

## 2026-07-04 12:00 — FIX-03: Remote auth and non-interactive env (D-05)

- **`app/src/lib/git/gitRemoteEnv.ts`** — `buildNonInteractiveRemoteEnv()` sets `GIT_TERMINAL_PROMPT=0` and SSH BatchMode for fail-fast remote ops without a TTY.
- **`app/src/lib/git/gitService.ts`** — remote fetch/pull/push and tag/ls-remote wrappers use non-interactive env plus per-command in-app askpass; tag push/delete accept `commandId`.
- **`app/src-tauri/src/git_askpass.rs`**, **`git.rs`**, **`lib.rs`** — askpass session scripts, prompt watcher, `respond_git_askpass` Tauri command, and per-command env lifecycle (no leak after command completes).
- **`app/src/lib/git/gitAskpass.ts`**, **`app/src/lib/services/askpassPrompt.ts`**, **`AskpassPrompt.svelte`** — event bridge, single-prompt mutex, credential dialog UI mounted in `AppShell`.
- **`app/src/lib/git/gitErrorUi.ts`** — expanded auth/SSH/credential stderr classification with actionable guidance.
- **`VersionControlView.svelte`**, **`GitTagsPanel.svelte`** — toolbar Cancel covers tag push/delete remote commands via shared command-id registration.
- **Tests** — `gitRemoteEnv.test.ts`, `askpassPrompt.test.ts`; updated `gitService.test.ts`, `gitCancel.test.ts`, `gitErrorUi.test.ts`.
- **`specs/git/execution/fixes/fix-03-remote-auth-and-non-interactive-env.md`**, **D-05 tasks** — marked `[DONE]`.

## 2026-07-04 11:47 — CI: Windows CRLF diff parsing and lockfile

- **`.gitignore`** — allowlist `app/package-lock.json` so CI `npm ci` and setup-node cache resolve the lockfile path.
- **`app/package-lock.json`** — committed locked frontend dependencies for reproducible CI installs.
- **`gitDiffParse.ts`** — strip `\r` from diff lines so Windows checkout (CRLF fixtures) parses binary and hunk headers correctly.
- **`projectTreeFileStatusMap.test.ts`** — normalize temp-repo paths for cross-platform badge lookups.

## 2026-07-04 11:30 — FIX-02: System git project-tree badges (S-01)

- **`app/src/lib/git/projectTreeFileStatusMap.ts`** — maps `git status --porcelain` codes to M/A/D badges with repo-root absolute paths.
- **`app/src/lib/services/fileStatusTracker.ts`** — git-backed workspaces read system git first; OpenCode `file.status` remains the fallback for non-git workspaces on the session tab. Debounced refresh on version-control mutations.
- **`app/src/lib/git/versionControlRefresh.ts`** — mutation subscribe/notify hooks wired from `VersionControlView.svelte`.
- **`app/src/routes/+page.svelte`** — git status refresh no longer gated on session-tab active state.
- **Tests** — `projectTreeFileStatusMap.test.ts`, `fileStatusTracker.git.test.ts`, extended `versionControlRefresh.test.ts`.
- **`specs/git/manual-test-checklist.md`** — project-tree badge checks aligned with VC Changes panel.
- **`specs/git/backlog.md`** — S-01 marked done.
- **`specs/git/execution/fixes/fix-02-system-git-project-tree-badges.md`** — marked `[DONE]`.

## 2026-07-04 10:45 — FIX-01: Autosave before working-tree mutations

- **`app/src/lib/components/GitChangesPanel.svelte`** — stage, unstage, and commit handlers call `prepareWorkspaceForGitOperation` before git mutations; accepts `workspaceRootPath` and `preGitSaveDeps` props (mirrors `GitBranchesPanel`).
- **`app/src/lib/components/VersionControlView.svelte`** — passes autosave deps into `GitChangesPanel`.
- **Tests** — added `gitChangesPreGitGuard.test.ts` documenting guard call sites in working-tree mutation handlers.
- **`specs/git/manual-test-checklist.md`** — Changes and Guards sections extended for autosave before stage/commit flows.
- **`specs/git/execution/fixes/fix-01-autosave-before-working-tree-mutations.md`** — marked `[DONE]`.

## 2026-07-04 10:30 — Git integration review: FIX execution plans

- **`specs/git/execution/fixes/`** — added 14 prioritized execution plans from the 2026-07-04 git integration code review:
  - **P0:** FIX-01 autosave before working-tree mutations; FIX-02 system git project-tree badges (S-01)
  - **P1:** FIX-03 remote auth/non-interactive env; FIX-04 ahead/behind error handling; FIX-05 workspace manager column refresh; FIX-06 per-repo git command queue
  - **P2:** FIX-07 probe/status performance; FIX-08 pull dirty-tree UX; FIX-09 cancellation/timeout; FIX-10 gitService modularization; FIX-11 porcelain v2; FIX-12 stash panel UI; FIX-13 Windows PATH fallback
  - **P3:** FIX-14 git integration polish (branch parsing, history pagination, diff docs, env blocklist, etc.)
- **`specs/git/execution/fixes/README.md`** — index table with priority and links.

## 2026-07-04 07:50 — D-12 Task 1: Cancel in-flight git processes

- **`app/src-tauri/src/git.rs`** — cancellable git command registry with command ids, platform process termination, `cancel_git_command` Tauri API, and `cancelled` flag on `RunGitResponse`.
- **`app/src/lib/git/types.ts`**, **`gitService.ts`** — `cancelGitCommand`, optional `commandId` on `runGit` and remote fetch/pull/push, and `GitCommandCancelledError`.
- **`app/src/lib/git/gitErrorUi.ts`** — informational cancellation toast helper (`notifyGitCancellation`).
- **`app/src/lib/components/VersionControlView.svelte`** — Cancel button during fetch/pull/push busy state; disables after cancel is requested; clears toolbar busy flags on completion/cancel.
- **Tests** — Rust cancellation race tests in `git.rs`; added `gitCancel.test.ts` and `gitErrorUi.cancel.test.ts`.
- **`specs/git/execution/d-12-01-cancel-in-flight-git-processes.md`** — marked `[DONE]`.

## 2026-07-04 07:25 — D-11 Task 1: Linux launch readiness plan

- **`.github/workflows/test.yml`** — cross-platform CI job (`ubuntu-latest`, `macos-latest`, `windows-latest`) runs the full vitest suite with git on PATH; Linux integration tests validated locally and in workflow.
- **`app/src/lib/git/gitParse.ts`** — decode git's octal-quoted UTF-8 path escapes in porcelain and name-status output (`core.quotepath` default on Linux).
- **Tests** — extended `gitParse.test.ts` for octal-quoted paths; `gitTempRepoHarness.ts` creates parent dirs for nested file paths.
- **`app/src-tauri/src/git.rs`** — Rust subprocess test for `git add` with spaced and non-ASCII path argv entries.
- **`specs/git/manual-test-checklist.md`** — Linux environment matrix (install path, credential helper, file mode, locale), non-ASCII path check, Linux smoke run (busy-state, fetch/pull/push, credential helper), known gaps table (L-01–L-04), and Linux sign-off row.
- **`app/src/lib/git/fixtures/README.md`** — documents three-platform test workflow strategy.
- **`specs/git/execution/d-11-01-linux-launch-readiness-plan.md`** — marked `[DONE]`.

## 2026-07-04 07:15 — D-10 Task 2: history filter UI and branch/remote scopes

- **`app/src/lib/git/versionControlHistoryFilter.ts`** — repo-scoped history filter mode persistence in `version-control-history-filter.json`, reconcile helpers, and toolbar option labels.
- **`app/src/lib/components/GitHistoryPanel.svelte`** — segmented history scope control (Branch / All branches / All + remotes), loads commits via `queryCommits({ filterMode })` with abort/cancel on rapid toggles, deterministic selection fallback, and current-branch graph highlighting via ref decoration in wider scopes.
- **Tests** — added `versionControlHistoryFilter.test.ts`.
- **`specs/git/manual-test-checklist.md`** — History section extended for scope switching, persistence, and selection fallback.
- **`specs/git/execution/d-10-02-history-filter-ui-and-branch-remote-scopes.md`** — marked `[DONE]`.

## 2026-07-04 06:47 — D-10 Task 1: history filter mode query contract

- **`app/src/lib/git/types.ts`** — `HistoryFilterMode` type (`current-branch`, `all-branches`, `all-branches-and-remotes`) and `DEFAULT_HISTORY_FILTER_MODE`; extended `QueryCommitsOptions` with optional `filterMode`.
- **`app/src/lib/git/gitService.ts`** — `buildQueryCommitsArgs` maps filter modes to `git log` scope flags (`--branches`, `--remotes`); `queryCommits` uses the builder while preserving default current-branch behavior and pagination.
- **`app/src/lib/git/gitService.test.ts`** — unit tests for argv construction in each filter mode and default fallback.
- **`specs/git/execution/d-10-01-history-filter-mode-query-contract.md`** — marked `[DONE]`.

## 2026-07-04 06:40 — D-08 Task 2 and D-09 Task 1: pre-git autosave integration and Workspace Manager git column

- **`app/src/lib/services/preGitOperationGuard.ts`** — `prepareWorkspaceForGitOperation` orchestrates autosave, partial-failure prompt, and legacy unsaved-document guard fallback.
- **`app/src/lib/services/preGitAutosavePrompt.ts`**, **`PreGitAutosavePrompt.svelte`** — dialog listing failed saves with Cancel (default) and Continue anyway.
- **`app/src/lib/components/VersionControlView.svelte`**, **`GitBranchesPanel.svelte`** — pull, checkout, and create branch call the pre-git guard before git commands start.
- **`app/src/lib/components/AppShell.svelte`**, **`EditorPaneContent.svelte`** — register autosave prompt and pass `windowId` save deps into version control.
- **`app/src/lib/git/repositoryStatusSummary.ts`** — `queryRepositoryStatusSummary` composes branch, ahead/behind, and dirty state for one repo root.
- **`app/src/lib/git/workspaceManagerGitColumn.ts`** — lazy/sequential git column loader with neutral and error placeholders.
- **`app/src/lib/components/WorkspaceManagerView.svelte`** — Git column with branch/tracking/dirty summary and **Refresh git** toolbar action.
- **Tests** — added `preGitOperationGuard.test.ts`, `preGitAutosavePrompt.test.ts`, `repositoryStatusSummary.test.ts`, `workspaceManagerGitColumn.test.ts`.
- **`specs/git/manual-test-checklist.md`** — Guards section extended for autosave success/failure flows; added Workspace Manager git column section.
- **`specs/git/execution/d-08-02-autosave-before-git-operations-integration.md`**, **`d-09-01-workspace-manager-git-column-foundation.md`** — marked `[DONE]`.

## 2026-07-04 06:32 — D-07 Tasks 1–2 and D-08 Task 1: stash service, checkout flow, pre-git autosave

- **`app/src/lib/git/types.ts`** — `GitStashSummary` type for structured stash list rows.
- **`app/src/lib/git/gitParse.ts`** — `GIT_STASH_LIST_FORMAT`, `parseStashList`, and `parseStashListItem` for NUL-delimited `git stash list -z` output.
- **`app/src/lib/git/gitService.ts`** — `createStash`, `queryStashes`, and `applyStash` with typed conflict/not-found/nothing-to-save errors.
- **`app/src/lib/git/fixtures/git-stash-list-z.txt`** — sample stash list stdout for parser tests.
- **`app/src/lib/services/localChangesCheckoutPrompt.ts`**, **`LocalChangesCheckoutPrompt.svelte`** — dialog for dirty-tree checkout: Cancel, Keep changes, or Stash and continue.
- **`app/src/lib/components/GitBranchesPanel.svelte`** — stash-assisted checkout with independent failure toasts for stash, checkout, and apply stages.
- **`app/src/lib/services/preGitAutosave.ts`** — `autosaveWorkspaceDirtyDocuments` reusing `saveDocumentKeepingTab`; structured saved/skipped/failure summary and opt-out flag.
- **Tests** — extended `gitParse.test.ts`, `gitService.test.ts`, `gitIntegration.test.ts`; added `preGitAutosave.test.ts`.
- **`specs/git/manual-test-checklist.md`** — Branches section extended for stash-assisted dirty checkout flows.
- **`specs/git/execution/d-07-01-stash-core-git-service-operations.md`**, **`d-07-02-stash-checkout-deal-with-local-changes-flow.md`**, **`d-08-01-autosave-service-for-dirty-documents.md`** — marked `[DONE]`.

## 2026-07-04 06:30 — D-06 Tasks 1–2: remote picker state, persistence, and toolbar integration

- **`app/src/lib/git/versionControlRemoteSelection.ts`** — toolbar remote selection model with `origin`-then-first fallback, repo-scoped persistence in `version-control-remote-selection.json`, and reconcile helpers after remote list refresh.
- **`app/src/lib/git/gitService.ts`** — optional `RemoteOperationTarget` on `fetchRemote`, `pullRemote`, and `pushRemote` for explicit remote (and optional branch) argv.
- **`app/src/lib/git/versionControlRemoteOps.ts`** — toolbar busy guard includes remotes-loading state.
- **`app/src/lib/components/VersionControlView.svelte`** — compact remote `<select>` in toolbar (writable repos with remotes), fetch/pull/push wired to selected remote, disabled states and hints when no remotes, selection persisted without panel refresh.
- **Tests** — `versionControlRemoteSelection.test.ts`; extended `gitService.test.ts` and `versionControlRemoteOps.test.ts`.
- **`specs/git/manual-test-checklist.md`** — Remote operations section extended for picker, persistence, fallback, and selection-stability flows.
- **`specs/git/execution/d-06-01-remote-picker-state-model-and-persistence.md`**, **`d-06-02-remote-picker-toolbar-integration.md`** — marked `[DONE]`.

## 2026-07-03 22:30 — Archived D-01–D-04 execution plans; added D-05–D-12 execution plans

- **`specs/archive/git/execution/`** — moved all previously completed execution plans (22 files) from `specs/git/execution/` into archive.
- **`specs/git/execution/`** — added new execution plans for backlog items D-05 through D-12, split into logically grouped tasks:
  - `d-05-01-askpass-command-and-credential-request-flow.md`
  - `d-05-02-askpass-ui-and-git-service-wiring.md`
  - `d-06-01-remote-picker-state-model-and-persistence.md`
  - `d-06-02-remote-picker-toolbar-integration.md`
  - `d-07-01-stash-core-git-service-operations.md`
  - `d-07-02-stash-checkout-deal-with-local-changes-flow.md`
  - `d-08-01-autosave-service-for-dirty-documents.md`
  - `d-08-02-autosave-before-git-operations-integration.md`
  - `d-09-01-workspace-manager-git-column-foundation.md`
  - `d-10-01-history-filter-mode-query-contract.md`
  - `d-10-02-history-filter-ui-and-branch-remote-scopes.md`
  - `d-11-01-linux-launch-readiness-plan.md`
  - `d-12-01-cancel-in-flight-git-processes.md`
- **Plan format updates** — each new plan includes explicit master-only branch policy at the top and SourceGit-related context links with both local-file and GitHub references.

## 2026-07-03 — D-04 Tasks 1–6: remote tag push/delete, dialogs, and presence hints

- **`app/src/lib/git/types.ts`** — `GitRemote` and `GitTagSummary` types for remote listing and tag rows with optional default-remote presence.
- **`app/src/lib/git/gitParse.ts`** — `parseRemoteVvLines`, `parseLsRemoteTags`, `resolveDefaultRemote`, and `mergeTagRemotePresence` parsers/helpers.
- **`app/src/lib/git/gitService.ts`** — `queryRemotes`, `queryRemoteTags`, `pushTag`, `deleteRemoteTag`, composite `deleteTag`, and `GitTagPartialDeleteError` for partial remote delete failures.
- **`app/src/lib/git/fixtures/`** — `git-remote-vv.txt` and `git-ls-remote-tags.txt` sample stdout.
- **`app/src/lib/services/tagPushPrompt.ts`**, **`tagDeletePrompt.ts`** — registry-runner prompt services mirroring existing dialog patterns.
- **`app/src/lib/components/TagPushPrompt.svelte`**, **`TagDeletePrompt.svelte`** — push-tag remote picker (with optional push-to-all) and delete-tag confirmation with remote checkbox.
- **`app/src/lib/components/GitTagsPanel.svelte`** — Push tag action, custom delete flow, default-remote presence badges after fetch refresh, toolbar remote-op busy guard.
- **`app/src/lib/components/VersionControlView.svelte`**, **`AppShell.svelte`** — wire `remoteOpBusy` and mount tag dialogs.
- **Tests** — parser/service unit coverage plus `describeIfGitInstalled` bare-remote push-tag integration.
- **`specs/git/execution/d-04-01-query-remotes-service.md`** through **`d-04-06-tag-list-remote-presence-hints.md`** — marked `[DONE]`.

## 2026-07-03 — D-03 Tasks 4–5: staged/unstaged diff source rules and refresh after mutations

- **`app/src/lib/git/workingTreeDiffSelection.ts`** — pure helpers to pick default diff selection, resolve active path/source after status reload (partial stage / list moves), and find the active status row.
- **`app/src/lib/git/gitStatusFormat.ts`** — `formatWorkingTreeDiffSubtitle` for **Staged changes**, **Unstaged changes**, and **Untracked file** labels.
- **`app/src/lib/components/GitTextDiffView.svelte`** — optional `subtitle` prop rendered under the file path in the diff header.
- **`app/src/lib/components/GitChangesPanel.svelte`** — diff list context preserved across refresh; `statusVersion` retriggers diff fetch when selection unchanged; mutations rely on `refreshToken` only (no double status load); subtitles wired from active list row.
- **Tests** — `workingTreeDiffSelection.test.ts` source-resolution coverage; `GitTextDiffView.test.ts` subtitle rendering.
- **`specs/git/manual-test-checklist.md`** — Changes section extended for diff subtitles, partial stage, untracked files, and diff refresh after stage/commit/Refresh.
- **`specs/git/execution/d-03-04-staged-unstaged-diff-source-rules.md`**, **`d-03-05-diff-refresh-after-mutations.md`** — marked `[DONE]`.

## 2026-07-03 — D-03 Tasks 1–3: working-tree file diff service, changes panel split layout, selection-driven diff

- **`app/src/lib/git/types.ts`** — `WorkingTreeDiffSource` union (`"unstaged" | "staged"`).
- **`app/src/lib/git/gitService.ts`** — `queryWorkingTreeFileDiff(repoRoot, path, source)`: staged via `git diff --cached`, unstaged via `git diff HEAD` with `--no-index` null-device fallback for untracked files; reuses `GitDiffTooLargeError` and unified diff parser; JSDoc documents simplified unstaged semantics.
- **`app/src/lib/components/GitChangesPanel.svelte`** — left/right split (lists + inline diff, commit area below); row click selects diff source while checkboxes keep multi-select staging; default first unstaged/staged selection; abort-safe diff loading; read-only bare-repo diff banner.
- **`app/src/lib/components/VersionControlView.svelte`** — flush full-height body layout for Changes section.
- **Tests** — mocked `queryWorkingTreeFileDiff` argv/parsing/guard coverage; `describeIfGitInstalled` integration for partial staging, untracked `--no-index`, and spaced paths.
- **`specs/git/execution/d-03-01-query-working-tree-file-diff.md`**, **`d-03-02-changes-panel-split-layout.md`**, **`d-03-03-file-selection-diff-loading.md`** — marked `[DONE]`.

## 2026-07-03 — D-02 Tasks 3–5: git text diff view, commit detail split layout, binary/large diff states

- **`app/src/lib/components/GitTextDiffView.svelte`** — unified single-pane diff viewer: file header with `+N` / `−M` summary, scrollable `[oldNo | newNo | prefix | content]` grid, added/deleted/hunk styling, loading/error/empty/binary/no-hunk states; horizontal scroll for long lines.
- **`app/src/lib/components/GitCommitDetailPanel.svelte`** — three-pane commit detail: metadata on top, resizable file list + inline diff below; default first-file selection; `queryCommitFileDiff` with abort on rapid changes; Up/Down keyboard navigation; `reportGitError` toasts on fetch failures.
- **`app/src/lib/components/VersionControlView.svelte`** — passes `notify` into commit detail for diff error toasts.
- **`app/src/lib/git/gitService.ts`** — `COMMIT_FILE_DIFF_MAX_BYTES` (512 KiB) guard and `GitDiffTooLargeError` before parsing oversized patch stdout.
- **Tests** — `GitTextDiffView.test.ts` fixture/binary/empty/loading/error coverage; `gitService.test.ts` size guard and binary diff path.
- **`specs/git/manual-test-checklist.md`** — History section updated for inline diff and binary/large-file placeholders.
- **`specs/git/execution/d-02-03-git-text-diff-view-component.md`**, **`d-02-04-commit-detail-split-layout-with-diff.md`**, **`d-02-05-binary-and-large-file-diff-states.md`** — marked `[DONE]`.

## 2026-07-03 — D-02 Tasks 1–2: unified diff parser and commit file diff service

- **`app/src/lib/git/types.ts`** — `DiffLineKind`, `DiffLine`, `DiffHunk`, and `ParsedTextDiff` types for structured patch output.
- **`app/src/lib/git/gitDiffParse.ts`** — pure `parseUnifiedDiff(stdout)` parser for multi-file unified patches: `diff --git` / `index` / `---` / `+++` headers, `@@` hunks with line-number tracking, `\ No newline at end of file`, and binary detection (`isBinary`, empty hunks).
- **`app/src/lib/git/fixtures/`** — `git-diff-unified-single-file.txt`, `git-diff-binary.txt`, `git-diff-multi-file.txt` sample patch stdout.
- **`app/src/lib/git/gitDiffParse.test.ts`** — fixture assertions for line counts, hunk boundaries, binary patches, and temp-repo integration.
- **`app/src/lib/git/gitService.ts`** — `DIFF_CONTEXT_LINES`, `queryCommitFileDiff(repoRoot, sha, path, parentSha?)` (`git diff parent..sha` vs root `git show`), `GitCommitFileDiffNotFoundError`; renamed paths match by new or previous path.
- **`app/src/lib/git/gitService.test.ts`** — mocked service tests for diff/show argv, rename lookup, errors, and missing path.
- **`specs/git/execution/d-02-01-unified-diff-patch-parser.md`**, **`d-02-02-query-commit-file-diff-service.md`** — marked `[DONE]`.

## 2026-07-03 — D-01 Tasks 5–6: graph scroll sync, row sizing, and branch highlighting

- **`app/src/lib/git/commitGraphLayout.ts`** — shared `ROW_HEIGHT` drives row alignment; `computeCurrentBranchCommitSet` walks the first-parent chain from HEAD; `buildCommitGraphLayout` accepts `highlightedShas` and marks dots/segments/curves with `isHighlighted` (segments dim when any crossed row is off the current branch).
- **`app/src/lib/components/GitHistoryPanel.svelte`** — fixed 26px commit rows, graph SVG height bound to `commits.length * ROW_HEIGHT`, shared scroll container with sticky graph gutter, `ResizeObserver` for column width on pane resize, virtualization alignment comment.
- **`app/src/lib/components/GitCommitGraphColumn.svelte`** — explicit `rowCount` prop for SVG height; `git-graph-dimmed` (~40% opacity) for non-current-branch primitives; selection ring stays full opacity.
- **Tests** — `computeCurrentBranchCommitSet` merge/truncated fixtures; highlighting and dimmed-class mount coverage.
- **`specs/git/execution/d-01-05-graph-scroll-sync-and-sizing.md`**, **`d-01-06-current-branch-graph-highlighting.md`** — marked `[DONE]`.

## 2026-07-03 — D-01 Tasks 3–4: commit graph SVG column and history panel integration

- **`app/src/lib/components/GitCommitGraphColumn.svelte`** — reusable SVG graph column rendering lane segments, quadratic merge curves, and commit dots (head/merge/default kinds) with an 8-color light/dark palette, selection ring via `--color-accent`, and decorative `aria-hidden` semantics.
- **`app/src/lib/components/GitCommitGraphColumn.test.ts`** — Vitest mount tests for linear/merge fixtures, SVG sizing (1 vs multi-lane), selection ring, and dot positioning.
- **`app/src/lib/git/commitGraphLayout.ts`** — `commitGraphColumnWidth`, `commitGraphRowCount`, and `GRAPH_RIGHT_PADDING` helpers shared by the graph component and history panel.
- **`app/src/lib/components/GitHistoryPanel.svelte`** — two-column scroll layout with a sticky-left graph gutter and commit rows; `$derived` layout from `buildCommitGraphLayout(commits)`; selection and refresh behavior preserved.
- **`specs/git/execution/d-01-03-commit-graph-svg-component.md`**, **`d-01-04-integrate-graph-into-history-panel.md`** — marked `[DONE]`.

## 2026-07-03 — D-01 Tasks 1–2: commit graph layout engine and fixtures

- **`app/src/lib/git/commitGraphLayout.ts`** — pure TypeScript layout engine (`buildCommitGraphLayout`) turning newest-first `CommitSummary[]` into lane-assigned dots, branch segments, and quadratic merge curves; fixed geometry constants (`ROW_HEIGHT`, `LANE_WIDTH`, `DOT_RADIUS`, 8-color palette); truncated-parent and octopus-merge edge cases handled without throwing.
- **`app/src/lib/git/fixtures/commit-graph-linear.json`** — five-commit linear chain fixture.
- **`app/src/lib/git/fixtures/commit-graph-merge.json`** — feature-branch merge topology (9 commits).
- **`app/src/lib/git/fixtures/commit-graph-truncated.json`** — parent SHA missing from log window.
- **`app/src/lib/git/commitGraphLayout.test.ts`** — Vitest coverage for linear, merge, truncated, and empty/single-commit cases; optional `describeIfGitInstalled` integration against real merge repo log output.
- **`app/src/lib/git/fixtures/README.md`** — documents graph topology fixtures.
- **`specs/git/execution/d-01-01-commit-graph-layout-algorithm.md`**, **`d-01-02-graph-fixtures-and-unit-tests.md`** — marked `[DONE]`.

## 2026-07-03 — Git MVP phase plans archived; D-01–D-04 execution tasks added

- **`specs/archive/git/`** — moved completed MVP phase 0–4 execution plans from `specs/git/`; cross-links to `version-control-idea.md` and `backlog.md` updated.
- **`specs/git/execution/`** — 22 post-MVP task files (one task per file) for backlog items D-01–D-04: commit graph (6), inline commit diff (5), working-copy diff (5), remote tag push/delete (6). Each includes master-only branch policy for agents.
- **`specs/git/version-control-idea.md`** — phase plan links point to archive; post-MVP execution folder linked.
- **`specs/git/backlog.md`** — D-01–D-04 rows link to `execution/`.

## 2026-07-02 — Git phase 4 Tasks 4.6–4.8: integration tests, manual checklist, OpenCode isolation — MVP sign-off

- **`app/src/lib/git/test/gitTempRepoHarness.ts`** — shared temp-repo harness (`createTempGitRepo`, `withTempGitRepo`, `describeIfGitInstalled`) for integration tests; skips when git is not on PATH.
- **`app/src/lib/git/gitIntegration.test.ts`** — end-to-end log, status, show, branch, and tag parser round-trips against real temp repositories.
- **`app/src/lib/git/gitParse.test.ts`** — integration sections refactored to use the harness and skip without git.
- **`app/src/lib/git/gitOpenCodeIsolation.test.ts`** — static audit: no `opencode*`, `workspaceAgentBackend`, or `fileStatusTracker` imports in git module or VC UI components.
- **`app/src/lib/git/fixtures/README.md`** — CI strategy documented (skip integration tests when git unavailable vs require git on release runners).
- **`app/src-tauri/src/git.rs`** — subprocess integration tests skip gracefully when git is not installed.
- **`specs/git/manual-test-checklist.md`** — macOS + Windows manual flows for init, history, branches, tags, changes, fetch/pull/push, guards, empty states, and OpenCode-off verification.
- **`specs/git/version-control-idea.md`** — §7.1 functional and §7.2 non-functional requirements checked off.
- **`specs/git/phase-4-execution-plan.md`** — Tasks 4.6–4.8 marked `[DONE]`; phase 4 exit criteria satisfied.
- **MVP sign-off:** Version Control MVP implementation complete per phase 0–4 plans; automated verification green (`npm test`, `npm run check`, Rust git tests). Manual macOS + Windows sign-off tracked in [manual-test-checklist.md](./git/manual-test-checklist.md).

## 2026-07-02 — Git phase 4 Tasks 4.4–4.5: cross-platform paths and toolbar busy UX

- **`app/src/lib/git/gitParse.ts`** — normalize repo-relative paths from porcelain status and name-status output to forward slashes for consistent UI display; normalized paths remain valid for `git add` / `git restore --staged`.
- **`app/src/lib/git/types.ts`** — `normalizeGitOutputPath` used at parse boundary (existing helper).
- **`app/src-tauri/src/git.rs`** — `git_message_file_arg` formats temp commit message paths with forward slashes for `git commit -F` on Windows.
- **`app/src/lib/git/versionControlRemoteOps.ts`** — shared toolbar busy guards (`canStartRemoteGitOperation`, `isVersionControlToolbarBusy`) blocking parallel fetch/pull/push/refresh.
- **`app/src/lib/components/VersionControlView.svelte`** — all toolbar buttons disabled while any remote op or refresh is in flight; busy labels clear in `finally` on success and error.
- **Tests** — `types.test.ts`, extended `gitParse.test.ts` / `gitService.test.ts`, `versionControlRemoteOps.test.ts`, Rust `git_message_file_arg` test.
- **`specs/git/backlog.md`** — D-12: cancel in-flight git subprocess deferred post-MVP.
- **`specs/git/phase-4-execution-plan.md`** — Tasks 4.4–4.5 marked `[DONE]`.

## 2026-07-02 — Git phase 4 Tasks 4.1–4.3: unsaved guard, bare/detached UX, git error surfacing

- **`app/src/lib/services/unsavedDocumentGuard.ts`** — `collectDirtyDocumentsForWorkspace` and `assertNoUnsavedDocuments` block checkout, pull, and branch creation when the active workspace has unsaved editor buffers (Cancel-only dialog).
- **`app/src/lib/git/gitService.ts`** — `queryIsBareRepository`; failed git commands now log stderr in console diagnostics.
- **`app/src/lib/git/versionControlProbe.ts`** — probe `ready` result includes `isBareRepository`.
- **`app/src/lib/git/gitErrorUi.ts`** — standardized `formatGitErrorPrimaryMessage` / `reportGitError` (status-bar toast + stderr in console) with mappings for auth, merge conflict, no upstream, and invalid git command cases.
- **`app/src/lib/components/VersionControlView.svelte`** — bare-repo and detached HEAD banners; read-only mode disables pull and write panels; fetch/pull/push failures use toast + console; pull guarded by unsaved-doc check.
- **`app/src/lib/components/GitBranchesPanel.svelte`**, **`GitChangesPanel.svelte`**, **`GitTagsPanel.svelte`** — unsaved-doc guard on checkout/create branch; read-only mode for bare repos; standardized git error reporting.
- **`app/src/lib/components/EditorPaneContent.svelte`** — passes `notify` into version control view.
- **Tests** — `unsavedDocumentGuard.test.ts`, `gitErrorUi.test.ts`; extended probe/service tests.
- **`specs/git/phase-4-execution-plan.md`** — Tasks 4.1–4.3 marked `[DONE]`.

## 2026-07-02 — Git phase 3 Tasks 3.8–3.12: pull, push, tags, refresh bundle

- **`app/src/lib/git/gitService.ts`** — `pullRemote`, `pushRemote` (with `GitNoUpstreamError` for missing upstream), `createTag`, and `deleteLocalTag`; all `run_git` / commit invocations log command + exit code to the app console via `logDiagnostic`.
- **`app/src/lib/git/versionControlRefresh.ts`** — `VersionControlMutationScope` and `mutationChangesHead` helper for scoped post-mutation refresh.
- **`app/src/lib/components/VersionControlView.svelte`** — **Pull** and **Push** toolbar buttons (busy states, dirty-tree block on pull, stderr dialogs); centralized `refreshAfterMutation(scope)` refreshes header + active panels via `panelRefreshToken`.
- **`app/src/lib/components/GitTagsPanel.svelte`** — create tag prompt (ref validation), selectable tag list, delete with confirmation (`git tag -d` local only).
- **`app/src/lib/components/GitChangesPanel.svelte`**, **`GitBranchesPanel.svelte`** — pass mutation scope to `onMutation` (`commit`, `stage`, `checkout`, `branch`).
- **`app/src/lib/git/gitService.test.ts`**, **`app/src/lib/git/versionControlRefresh.test.ts`** — unit tests for pull/push/tag commands, no-upstream handling, and git command logging.
- **`specs/git/phase-3-execution-plan.md`** — Tasks 3.8–3.12 marked `[DONE]`; phase 3 exit criteria checked off.

## 2026-07-02 — Git phase 3 Task 3.7: fetch from remote

- **`app/src/lib/git/gitService.ts`** — `fetchRemote(repoRoot)` runs `git fetch`; throws `GitCommandError` on failure.
- **`app/src/lib/components/VersionControlView.svelte`** — **Fetch** toolbar button with busy state ("Fetching…"); on success refreshes ahead/behind header and active panel via `panelRefreshToken`; network/git failures show stderr in an error dialog.
- **`app/src/lib/git/gitService.test.ts`** — unit tests for `fetchRemote` success and failure paths.
- **`specs/git/phase-3-execution-plan.md`** — Task 3.7 marked `[DONE]`.

## 2026-07-02 — Agent rule: work on master by default

- **`AGENTS.md`** — Added **Branching** rule: agents must not create separate feature branches or PRs; commit and push directly to `master` unless the user explicitly requests a branch/PR workflow.

## 2026-07-02 — Git phase 2 Tasks 2.6–2.8: branches/tags panels + refresh orchestration

- **`app/src/lib/git/gitParse.ts`** — `parseTagList` for `git tag -l` stdout (alphabetically sorted tag names).
- **`app/src/lib/git/gitService.ts`** — `queryTags(repoRoot)` via `git tag -l`.
- **`app/src/lib/components/GitTagsPanel.svelte`** — read-only tag list with empty state and disabled create/delete actions (phase 3).
- **`app/src/lib/components/VersionControlView.svelte`** — Tags section wired to `GitTagsPanel`; **Refresh** toolbar button with debounce, silent repo re-probe, header loading indicator, and `panelRefreshToken` orchestration for active section reload.
- **`app/src/lib/components/GitHistoryPanel.svelte`**, **`GitCommitDetailPanel.svelte`** — accept `refreshToken` prop for coordinated refresh.
- **`app/src/lib/git/gitParse.test.ts`**, **`app/src/lib/git/gitService.test.ts`** — tag parser and `queryTags` wrapper tests.
- **`specs/git/phase-2-execution-plan.md`** — Tasks 2.6, 2.7, and 2.8 marked `[DONE]`.

## 2026-07-02 — Git phase 3 Tasks 3.1–3.6: working tree status, changes panel, commit, branch checkout/create

- **`app/src/lib/git/types.ts`** — `WorkingTreeFileEntry` and `WorkingTreeStatus` types for porcelain status queries.
- **`app/src/lib/git/gitParse.ts`** — `parseStatusPorcelain` (v1 porcelain) and `splitWorkingTreeStatus` to separate staged vs unstaged entries (untracked in unstaged).
- **`app/src/lib/git/gitService.ts`** — `queryWorkingTreeStatus`, `isWorkingTreeDirty`, `stagePaths`, `stageAll`, `unstagePaths`, `createCommit`, `checkoutBranch`, and `createBranch`.
- **`app/src/lib/git/gitRefName.ts`** — `validateGitRefName` for basic branch name rules before git calls.
- **`app/src/lib/git/gitStatusFormat.ts`** — status code labels for the Changes panel.
- **`app/src-tauri/src/git.rs`** — `git_commit_with_message` Tauri command (`git commit -F` via secure temp file).
- **`app/src/lib/components/GitChangesPanel.svelte`** — unstaged/staged lists with multi-select, stage/unstage actions, commit message + Commit button (disabled when nothing staged).
- **`app/src/lib/components/GitBranchesPanel.svelte`** — branch list with checkout (dirty-tree block dialog) and create-branch prompt with validation.
- **`app/src/lib/components/VersionControlView.svelte`** — wires Changes and Branches panels; `refreshAfterMutation` refreshes header + history via `panelRefreshToken`.
- **`app/src/lib/components/GitHistoryPanel.svelte`** — accepts `refreshToken` to reload after commits/checkout.
- **`app/src/lib/git/fixtures/git-status-porcelain.txt`** — expanded fixture (staged, unstaged, rename, quoted paths).
- **`app/src/lib/git/gitParse.test.ts`**, **`app/src/lib/git/gitService.test.ts`**, **`app/src/lib/git/gitRefName.test.ts`** — parser, service, and ref-name validation tests.
- **`specs/git/phase-3-execution-plan.md`** — Tasks 3.1–3.6 marked `[DONE]`.

## 2026-07-02 — Git phase 2 Tasks 2.4–2.5: commit detail pane + branch list query

- **`app/src/lib/git/types.ts`** — `CommitDetail`, `CommitFileChange`, and `BranchSummary` types for detail pane and branch queries.
- **`app/src/lib/git/gitParse.ts`** — `GIT_SHOW_FORMAT`, `parseCommitShow`, `parseBranchVvLine`, and `parseBranchVvLines` for `git show --name-status` and `git branch -vv` stdout.
- **`app/src/lib/git/gitService.ts`** — `queryCommitDetail(repoRoot, sha)` and `queryBranches(repoRoot)`.
- **`app/src/lib/git/fixtures/git-show-name-status.txt`** — sample `git show --name-status` stdout for parser tests.
- **`app/src/lib/components/GitCommitDetailPanel.svelte`** — commit metadata + changed-files list (A/M/D/R); loading, error, and empty-selection states; no diff hunks.
- **`app/src/lib/components/VersionControlView.svelte`** — responsive history split layout (list beside detail on wide viewports, stacked on narrow).
- **`app/src/lib/git/gitHistoryFormat.ts`** — `formatCommitTimestamp` for detail pane dates.
- **`app/src/lib/git/gitParse.test.ts`**, **`app/src/lib/git/gitService.test.ts`** — branch fixture parser tests, commit show parser/integration tests, and query wrapper tests.
- **`specs/git/phase-2-execution-plan.md`** — Tasks 2.4 and 2.5 marked `[DONE]`.

## 2026-07-02 — Git phase 2 Task 2.3: history panel UI

- **`app/src/lib/git/gitHistoryFormat.ts`** — `formatShortSha`, `formatRelativeCommitDate`, and `commitRefBadgeTitle` helpers for history list rows.
- **`app/src/lib/components/GitHistoryPanel.svelte`** — scrollable commit list (subject, short SHA, author, relative date) with branch/tag ref badges; loading, error, and empty-repo states; row selection callback for Task 2.4 detail pane.
- **`app/src/lib/components/VersionControlView.svelte`** — History section renders `GitHistoryPanel` when repo is ready; tracks selected commit SHA.
- **`app/src/lib/git/gitHistoryFormat.test.ts`** — unit tests for SHA abbreviation and relative date formatting.
- **`specs/git/phase-2-execution-plan.md`** — Task 2.3 marked `[DONE]`.

## 2026-07-02 — Git phase 2 Task 2.2: commit log query + parser

- **`app/src/lib/git/types.ts`** — `CommitSummary`, `CommitDecorator`, `QueryCommitsOptions`, and `DEFAULT_COMMIT_LOG_LIMIT` (500).
- **`app/src/lib/git/gitParse.ts`** — `GIT_LOG_FORMAT`, `parseCommitDecorators`, and `parseLogCommits` for structured NUL-separated `git log` output; branch/tag ref decorations parsed from `%D`.
- **`app/src/lib/git/gitService.ts`** — `queryCommits(repoRoot, { limit })` using `git log --no-show-signature --decorate=full` with configurable limit (default 500).
- **`app/src/lib/git/gitParse.test.ts`**, **`app/src/lib/git/gitService.test.ts`** — fixture parser tests, decorator parsing coverage, temp-repo integration test, and `queryCommits` wrapper tests.
- **`specs/git/phase-2-execution-plan.md`** — Task 2.2 marked `[DONE]`.

## 2026-07-02 — Git phase 2 Task 2.1: current branch + upstream query

- **`app/src/lib/git/types.ts`** — `CurrentBranchInfo` and `AheadBehindCounts` types for branch header queries.
- **`app/src/lib/git/gitParse.ts`** — parser helpers for `git branch --show-current`, upstream ref, short HEAD, and ahead/behind rev-list output.
- **`app/src/lib/git/gitService.ts`** — `queryCurrentBranch(repoRoot)` and `queryAheadBehind(repoRoot)` using `branch --show-current`, `rev-parse`, and `rev-list --left-right --count @{u}...HEAD`.
- **`app/src/lib/git/gitParse.test.ts`**, **`app/src/lib/git/gitService.test.ts`** — unit tests for branch/upstream parsers and query wrappers.
- **`app/src/lib/components/VersionControlView.svelte`** — header shows live branch name, detached HEAD badge, upstream tracking summary (ahead/behind or “No upstream”).
- **`specs/git/phase-2-execution-plan.md`** — Task 2.1 marked `[DONE]`.

## 2026-07-02 — Git phase 1 Tasks 1.5–1.6: VC empty states and init repository

- **`app/src/lib/git/versionControlProbe.ts`** — `probeVersionControlContext` probes git availability and repo root on mount/workspace change; `initRepositoryAtWorkspaceRoot` runs `git init`; `workspaceUsesParentRepository` detects nested workspace folders inside a parent repo.
- **`app/src/lib/git/gitInstallHints.ts`** — platform-aware install copy and download links for macOS and Windows when git is missing.
- **`app/src/lib/components/VersionControlView.svelte`** — dedicated empty states for missing git, non-repo workspace, and probe errors; section sidebar hidden until repo is valid; parent-repo scope note when workspace is nested inside an existing repository; **Init repository** button with confirm dialog and re-probe after success.
- **`app/src/lib/git/versionControlProbe.test.ts`**, **`app/src/lib/git/gitInstallHints.test.ts`** — unit tests for probe, init, parent-repo detection, and install hints (10 tests).
- **`specs/git/phase-1-execution-plan.md`** — Tasks 1.5, 1.6 marked `[DONE]`.

## 2026-07-02 — Git phase 1 Tasks 1.2–1.4: VC context menu, shell view, editor routing

- **`app/src/lib/services/workspaceContextMenuController.ts`** — `openVersionControl(workspaceId)` switches context and opens/focuses the singleton `"version-control"` view tab; menu closes after action.
- **`app/src/lib/services/workspaceContextMenuController.test.ts`** — unit test for `openVersionControl`.
- **`app/src/lib/components/AppShell.svelte`** — workspace context menu item **Version Control** (after Settings).
- **`app/src/routes/+page.svelte`** — wire `onOpenVersionControl` through AppShell props.
- **`app/src/lib/components/VersionControlView.svelte`** — shell with sidebar sections (History, Branches, Tags, Changes), placeholder bodies, and disabled Fetch/Pull/Push header stub; accepts `workspaceRootPath`.
- **`app/src/lib/components/EditorPaneContent.svelte`** — render `VersionControlView` when `activeViewTabKind === "version-control"`.
- **`app/src/lib/components/TabBar.svelte`** — tab strip title/tooltip **Version Control**.
- **`specs/git/phase-1-execution-plan.md`** — Tasks 1.2, 1.3, 1.4 marked `[DONE]`.

## 2026-07-02 — Git phase 1 Task 1.1: widen view-tab domain for version-control

- **`app/src/lib/domain/document.ts`** — add `"version-control"` to `ViewTabState.view`, `createViewTab`, and `normalizeTabState`.
- **`app/src/lib/state/appState/documentTabsSlice.ts`** — `openOrFocusViewTab("version-control")` opens or focuses a singleton tab per session.
- **`app/src/lib/components/editorRouting.ts`** — extend `EditorViewKind` comment for Version Control.
- **`app/src/lib/state/appState/documentTabsSlice.test.ts`** — singleton open/focus test for version-control view tab.
- **`specs/git/phase-1-execution-plan.md`** — Task 1.1 marked `[DONE]`.

## 2026-07-02 14:02 — Git phase 0 Tasks 0.5–0.6: gitService wrappers and parser fixtures

- **`app/src/lib/git/gitService.ts`** — `runGit(repoRoot, args, env?)` and `checkGitAvailable()` thin wrappers around Tauri `invoke`; `resolveRepoRoot` refactored to use `runGit`. Tauri validation failures map to typed `GitError` via `mapGitInvokeError`.
- **`app/src/lib/git/types.ts`** — `createGitInvalidPathError`, `mapGitInvokeError` for invoke error mapping.
- **`app/src/lib/git/gitService.test.ts`** — tests for `runGit`, `checkGitAvailable`, and existing `resolveRepoRoot` (7 tests total).
- **`app/src/lib/git/gitParse.ts`** — `parseLogCommitLine` for structured NUL-separated log output; placeholder exports for branch, tag, and status parsers (phase 2/3).
- **`app/src/lib/git/gitParse.test.ts`** — fixture-backed parse test for a single commit line plus fixture documentation checks.
- **`app/src/lib/git/fixtures/`** — sample stdout for `git log --format=…`, `git branch -vv`, `git tag -l`, `git status --porcelain` with README documenting source commands.
- **`specs/git/phase-0-execution-plan.md`** — Tasks 0.5, 0.6 marked `[DONE]`.

## 2026-07-02 13:50 — Git phase 0 Tasks 0.2–0.4: git probe, subprocess executor, repo root resolution

- **`app/src-tauri/src/git.rs`** — `git_available` Tauri command probes `git --version` on PATH and returns `{ available, version, error }`. `run_git` spawns `git` with `current_dir = repo_root`, argv passthrough (no shell), UTF-8 stdout/stderr capture, exit code and duration; rejects empty or relative `repo_root` with path normalization via `canonicalize`. Nine Rust unit/integration tests (availability shape, status in temp repo, argv with spaces, non-zero stderr, nested `rev-parse`, exit 128 not-a-repo).
- **`app/src-tauri/src/lib.rs`** — register `git::git_available` in invoke handler.
- **`app/src/lib/git/types.ts`** — shared `RunGitResponse`, `GitAvailableResponse`, `GitError` union, `GitNotARepositoryError`, helpers and type guards.
- **`app/src/lib/git/gitService.ts`** — `resolveRepoRoot(workspaceRootPath)` invokes `run_git` with `rev-parse --show-toplevel`; maps exit code 128 / not-a-repo stderr to typed `GitNotARepositoryError`.
- **`app/src/lib/git/gitService.test.ts`** — nested subdirectory fixture, not-a-repo error, stderr-only not-a-repo mapping (3 tests).
- **`specs/git/phase-0-execution-plan.md`** — Tasks 0.2, 0.3, 0.4 marked `[DONE]`.

## 2026-07-02 — Git phase 0 Task 0.1: Rust git module scaffold

- **`app/src-tauri/src/git.rs`** — new git module with `RunGitRequest` / `RunGitResponse` types and stub `run_git` Tauri command returning empty success (`exitCode: 0`, empty stdout/stderr, `durationMs: 0`). Doc comment documents that backend `std::process::Command` spawn (Task 0.3) does not require shell-plugin capabilities; IPC uses default registered-command ACL.
- **`app/src-tauri/src/lib.rs`** — register `mod git` and `git::run_git` in the invoke handler.
- **`specs/git/phase-0-execution-plan.md`** — Task 0.1 marked `[DONE]`.

## 2026-07-02 — Cross-context file opening (notepad non-restrict)

- **Optional context restriction** — implements `specs/text-editor/notepad-non-restrict-plan.md`. New global setting **Restrict files to their context** (Editor → Contexts; default off). When off, files open in whichever context is active (Notepad or any workspace) with one tab per path per window; existing tabs are focused without migration. When on, legacy behavior is preserved (outside paths → Notepad, workspace files migrate from Notepad, Save As outside root moves tab).
- **Settings:** `restrictFilesToContext` on `AppSettingsState`, persisted in `settings.json`; `services/fileContextPolicy.ts` helper.
- **Open pipeline:** `requestOpenPath` branches on restriction; File → Open Recent, Open All in Folder, and Open All Nearby use `runOpenInActiveContext`.
- **Save:** Save-on-close and Save As tab moves gated on the setting.
- **Tests:** `openFileGate`, `fileContextPolicy`, `documentSave`, `settingsStore`, `settingsSlice`.

## 2026-07-02 — Line counter fixes (phases 1–4.3)

- **Workspace Settings line counter** — implements `specs/text-editor/line-counter-fixes.md` phases 1–4.3 (Rust walker deferred).
  - **UI:** Fresh panel shows `—` / “not scanned yet” instead of misleading `0`; `readErrors` surfaced in a collapsible `<details>` block; `{#key workspaceRoot}` reset when switching scoped roots.
  - **Cache:** New in-memory `services/lineCounterCache.ts` keyed by normalized root path; results survive leaving and re-entering Workspace Settings within a session.
  - **Walker:** In-flight dedupe per root, `AbortSignal` on unmount/root change, progress callback with file count, event-loop yield every 50 files, sync `joinDirectoryPath` (no per-entry IPC `join`), `ensureWorkspaceReadAccess` before scan, skip files above 5 MiB with `readErrors` entry.
  - **Tests:** `lineCounterCache.test.ts` (3) and extended `lineCounter.test.ts` walker tests (5). Suite green.

## 2026-07-02 — Git specs: reference links + AGENTS rule

- **`specs/git/**`** — all reference-project links now include a GitHub fallback ([sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)) alongside local checkout paths so cloud agents can read reference code. Task-level “Required context” entries link to matching paths on GitHub where applicable.
- **`AGENTS.md`** — new **Reference projects** rule: do not use reference-project names or internal ids in commits, changelog, code comments, or user-visible strings; specs may still link to reference repos for design examples.

## 2026-07-02 — Version Control (git) specs

- **New spec pack:** `specs/git/` — approved design and phased implementation plans for workspace **Version Control** (system git via Tauri, singleton view tab from workspace context menu). Locked decisions: independent of OpenCode; auto repo-root discovery; flat current-branch history; Changes panel with stage/commit; fetch/pull/push on default upstream; macOS + Windows first.
  - **`version-control-idea.md`** — summary, goals, locked decisions (incl. Q7: VC module fully independent; project-tree M/A/D badges stay OpenCode-driven in MVP), UX, architecture, git command matrix, requirements, phase overview.
  - **`backlog.md`** — deferred MVP items (graph, diffs, askpass, remote picker, etc.), SpecOps follow-ups (system-git tree badges S-01, Workspace Manager columns), and SourceGit feature inventory by area.
  - **`phase-0-execution-plan.md`** … **`phase-4-execution-plan.md`** — atomic ~0.5–1d tasks with agent complexity estimates (~22–25.5 days total MVP).

## 2026-07-02 — Remove title-bar OpenCode status button

- **Removed the top-right title-bar status button** and its `StatusPopover` UI (M5-T4). The title bar is again a plain drag region only. Dropped `AppShellStatusPopoverProps`, the `+page.svelte` popover state/effect, and the unused `StatusPopover.svelte` component; `opencodeStatusSummary` remains available for future settings surfacing.

## 2026-07-02 — Cross-context file opening plan

- **New spec:** `specs/text-editor/notepad-non-restrict-plan.md` — approved implementation plan for optional cross-context file tabs. Default (restriction off): files may open in whichever context is active (Notepad or any workspace) with one tab per path per window. Opt-in **Restrict files to their context** (Editor → Contexts) preserves today’s behavior (outside paths → Notepad, workspace files migrate from Notepad, Save As outside root moves tab). Locked decisions: focus existing tab when already open elsewhere, global setting, unchanged cross-window registry. Four phases (~1–1.25 days): settings plumbing, open pipeline, save alignment, tests.

## 2026-07-02 — Line counter fix plan

- **New spec:** `specs/text-editor/line-counter-fixes.md` — bug analysis and phased fix plan for the Workspace Settings line counter (stuck “Counting…”, always 0 after re-enter). Covers root causes (ephemeral state, IPC-heavy walker, silent `readErrors`, overlapping walks), confirmation steps, and four implementation phases: UI correctness, in-memory cache, abort/dedupe/progress, and performance (sync path join → optional Rust walker).

## 2026-07-01 (20:59) — Workspace Manager

- **New: Workspace Manager** — an app-level overview of every workspace open in the current window, opened as a singleton **notepad** view tab (kind `workspace-manager`). Reachable from **SpecOps → Workspace Manager** (below Settings) and a new **≡** button on the activity rail, stacked beneath the **+** (Add Workspace) button in a bottom-aligned footer. Implements `specs/text-editor/workspace-manager-idea.md` (v1 scope).
  - **Manager table** (`WorkspaceManagerView.svelte`): lists every workspace with name + path columns; **row click switches** to that workspace (`switchContext`); a per-row **⚙ Settings** button switches to the workspace and focuses its `workspace-settings` view tab (same flow as the rail context menu). Shows an empty state with the add buttons when no workspaces are open.
  - **Add / Add multiple:** "Add workspace" reuses `workspace.add`. "Add multiple…" opens a folder picker, then a modal (`AddMultipleWorkspacesModal.svelte`) listing the **immediate subfolders** as checkboxes (all unchecked by default, already-open paths disabled and tagged). "Add selected" batch-adds via the same `addWorkspace` per path (duplicates skipped, summary notify). Backed by a new pure, dependency-injected helper `collectImmediateSubfolders(parentPath, existingRootPaths)` (`services/workspaceSubfolders.ts`) that keeps directories only, skips symlinks, normalizes each path against the session dedup key before the `exists` check, and sorts alphabetically.
  - **Hide from sidebar (global):** a **Show in sidebar** toggle in **Workspace Settings → Overview** (inverted from the stored `hiddenFromRail` flag). Hidden workspaces are filtered out of the activity rail in every window but stay listed and switchable in the manager. Persisted as `workspace-preferences.json` in the app data dir, keyed by normalized root path, via a new best-effort store `services/workspacePreferences.ts` (`loadWorkspacePreferences`/`getHiddenRootPaths`/`isHiddenFromRail`/`setHiddenFromRail`/`subscribeWorkspacePreferences`). Loaded during runtime startup; `+page.svelte` derives `railWorkspaces` (filtered) for the rail while the manager always receives the full list, and subscribes so toggles update the rail immediately.
  - **Plumbing:** widened `ViewTabState.view` (+ `createViewTab`/`normalizeTabState`/`openOrFocusViewTab`) and `EditorViewKind` to include `"workspace-manager"`; `EditorPaneContent.svelte` renders the new view; `TabBar.svelte` titles/tooltips it "Workspace Manager". New command `app.openWorkspaceManager` (`SpecOps/Workspace Manager` menu item) = `switchContext("notepad")` + `openOrFocusViewTab("workspace-manager")`. `AppShell` gained `AppShellWorkspaceManagerProps` (threaded through the editor chrome) and `AppShellAddMultipleWorkspacesProps` (modal overlay). The activity rail's `+` button's `margin-top: auto` moved to a `.rail-footer-stack` wrapping both `+` and `≡`.
  - **Tests:** new `workspaceSubfolders.test.ts` (6) and `workspacePreferences.test.ts` (7); added `app.openWorkspaceManager` dispatch + singleton-focus tests to `appViewHandlers.test.ts` and its coverage list. Suite green (2065 tests).

## 2026-07-01 — Workspace Manager spec

- **New spec:** `specs/text-editor/workspace-manager-idea.md` — approved design and five-phase implementation plan for the Workspace Manager (notepad view tab, activity-rail entry, add/add-multiple flows, global hide-from-sidebar preference, locked v1 scope).

## 2026-07-01 — Project panel tree indent

- **Tighter project tree nesting.** Reduced `--tree-indent` from 14px to 4px (~70% less horizontal offset per depth level) so nested files and folders sit closer to their parents (`tokens.css`; used by `ProjectTreeNode.svelte` and loading rows in `ProjectTreeList.svelte`).

## 2026-07-01 — Workspace settings tab + tooltip/context-menu polish

- **New: Workspace Settings tab (with line counter).** The workspace right-click context menu gained a **Settings** action (first item) that switches to the workspace and opens a dedicated **Workspace Settings** view in a separate editor tab (kind `workspace-settings`). It is a chrome-less editor-pane view tab following the existing Settings/Themes pattern — singleton per session, ephemeral (stripped from persisted sessions), and titled "Workspace Settings" in the tab strip.
  - The view ships with a first **Overview → Line counter** section: a TypeScript port of the Unity-AI-Hub `line_count.rs` LineWalker algorithm (`services/lineCounter.ts`). It counts newline lines in source files (C/C++, Go, Rust, Python, JS/TS, Java, Kotlin, Swift, C#, HTML/CSS, Svelte, Vue, …) using the same allowlist, prunes dot-dirs and dependency/build folders (`node_modules`, `target`, `dist`, `build`, `vendor`, `__pycache__`), skips symlinks, and reports total lines plus code-file / ignored-file / skipped-directory counts via a "Run line count" button. Markdown/JSON/YAML/TOML are excluded as data/docs. No Rust changes — uses the already-permissioned `@tauri-apps/plugin-fs` (`readDir`/`readFile`).
  - Domain/routing widened: `ViewTabState.view` and `createViewTab`/`normalizeTabState`/`openOrFocusViewTab` accept `"workspace-settings"`; new `EditorViewKind` type alias shared by `editorRouting.ts` view-kind resolvers; `EditorPaneContent` renders `<WorkspaceSettingsView>` for the new kind, scoped by the active workspace root path threaded through `AppShellEditorChromeProps.workspaceRootPath`.
- **Workspace rail tooltips — hide on right-click, longer delay, suppressed while menu open.** `HoverTooltip` now hides immediately on `contextmenu` (so right-clicking a workspace removes its tooltip instantly) and gained a `suppress` prop that reactively tears down any visible/pending tooltip. Workspace rail buttons doubled their hover delay (200ms → 400ms) and pass `suppress` whenever a workspace context menu is open (`contextMenuWorkspaceId` prop threaded from `+page.svelte` → `AppShell` → `ActivityRail`), so the tooltip never overlaps the menu. (`HoverTooltip.svelte`, `ActivityRail.svelte`, `AppShell.svelte`.)

## 2026-07-01 — Default markdown view setting

- **New setting: default markdown view mode (defaults to Preview).** Newly opened markdown files now start in **preview** by default instead of edit. Added a "Markdown → Default view" dropdown (Edit / Split / Preview) to the Editor settings panel (`EditorSettingsPanel.svelte`) so users can change the initial view. The setting persists to `settings.json` (`defaultMarkdownViewMode`, validated to `edit`/`split`/`preview`, falling back to `preview`) and loads via `applyPersistedSettings`.
  - Wired through the full settings stack following the existing `decoratePlaintextSymbols` pattern: new `AppSettingsState.defaultMarkdownViewMode` field + `setDefaultMarkdownViewMode` setter (`appState.ts`), defaults + normalization (`settingsSlice.ts`), persistence round-trip (`settingsStore.ts`, `appShellRuntime.ts`, `appShellEffects.ts`).
  - `buildDocument` (`documentHelpers.ts`) seeds markdown documents with the configured default; non-markdown files and untitled drafts keep `edit`. The open flows in `documentContentSlice.ts` (`openFileInTab`/`openFileInPane`) and `tabTransferSlice.ts` pass `state.settings.defaultMarkdownViewMode` when constructing new documents. Session restore preserves each document's previously saved per-document mode — only first-open gets the default.

## 2026-07-01 — Find in Project + sidebar/panel UI fixes

- **Find in Project (new).** Added project-wide search and replace, surfaced via a new resizable bottom panel (`ProjectSearchPanel.svelte`) that mirrors the console panel's show/resize pattern. Binds `Cmd/Ctrl+Shift+F` (Find in Project) and `Cmd/Ctrl+Shift+R` (Replace in Project), with matching native Edit-menu items.
  - **Search** walks the whole active workspace (reusing `collectOpenableFolderFiles`, which skips `node_modules`/`.git`/hidden dirs and non-openable/binary files), reads each file, and matches via the existing pure `findAllMatches` helper. Results are grouped per file with line/column/preview and clickable to open the file at the match (`editorRunner.goToLine`).
  - **Replace** writes back to disk via a new `replaceInProjectFile` (projectFileOps, guarded by `isPathUnderRoot`/blocked-dir checks, reusing the new pure `applyReplaceAll`), then syncs any open document for that path (`setDocumentContent` + `markDocumentSaved`).
  - New pure helpers: `searchInProject`/`computeFileMatches`/`totalMatchCount` (`services/projectSearch.ts`), `applyReplaceAll` (`editor/editorSearchOps.ts`); new command IDs `app.findInProject`/`app.replaceInProject` (`domain/commands.ts`, `commands/definitions.ts`, handlers, keydown special-case, native menu). The `CommandContext` gained an optional `openProjectSearch(focusReplace)` callback wired from `+page.svelte`.
- **Sidebar — Notepad button 2px top offset.** Collapsed activity-rail padding changed from `0 var(--space-1)` to `var(--space-1) var(--space-1)` so the Notepad button no longer sits flush against the top border (`ActivityRail.svelte`).
- **Find/Replace panel — button overflow fix.** Wrapped the input + trailing action buttons in a new `.fr-field-group` flex container (bounded by panel padding) so prev/next/close stay inside the panel instead of being pushed past the rounded right edge; widened panel 400→440px, tightened row gap 8→6px, shrank counter min-width 56→44px (`FindReplacePanel.svelte`).

## 2026-06-30 — Split-view session restore: all panes persist

- **Grid / multi-pane tabs survive relaunch.** Open-file registry sync and restore dedupe now scan every pane in the editor layout (not just the active pane), so documents and tabs in non-focused layout groups are kept across sessions.

## 2026-06-30 — Implicit untitled drafts per pane

- **Every file pane starts with a hidden untitled draft.** New and empty panes get an implicit `stripHidden` file tab plus empty document so the editor is ready to type without showing a tab until content appears (state A → B).
- **Closing the last empty untitled tab returns to a hidden draft** (state C) instead of a visible bootstrap tab; File → New still opens a visible tab immediately.
- **Split-view seeding and UI.** Layout presets seed hidden drafts into new panes; `TabBar` filters hidden tabs; `EditorPaneView` / `EditorGridLayout` render the selected draft editor even when the strip is empty. Pane-aware tab close uses `findTabOwner` across the layout.

## 2026-06-30 — Split-view layout geometry + equal pane sizing fix

- **View → Layout presets render correctly again.** `setLayoutKind` now re-applies a preset when `kind` matches but `slots` are stale (e.g. empty or row-shaped while kind is `cols-2`). New `effectiveLayoutSlots` helper resolves render-time geometry; `EditorGridLayout` assigns explicit `grid-row` / `grid-column` from slot coordinates instead of relying on auto-placement.
- **Equal pane height restored.** Repaired the editor-shell height chain (`shell-main-row`, `editor-shell`, `editor-grid`, grid cells) so `1fr` row tracks fill the available editor area and empty/new panes no longer collapse to a single tab-bar line.

## 2026-06-30 13:54

- **Freeze fix F3-B — stable editor host per pane.** Each split pane now keeps a persistent editor subtree across tab and pane-focus changes: `EditorGridLayout` renders per-pane content via `renderPaneContent`, `EditorPaneView` no longer swaps inactive panes to placeholders, and new `EditorPaneContent` resolves tab/document routing per pane (including lazy markdown preview HTML).
- **Active-pane command runner semantics preserved.** `EditorSurface` re-publishes its command runner when registration becomes available; `AppShell` clears `editorRunner` on active-pane switch and when the active tab is non-text, so only the focused pane's editor drives find/replace, go-to, and status-bar commands.
- **Pane-scoped routing helpers + tests.** Added `paneActiveTab` and pane-level routing predicates (`isSessionTabActiveInPane`, `activeViewKindInPane`) with coverage in `editorLayout.test.ts` and `editorRouting.test.ts`. Validated with `npm run check` and full `npm test` (1994/1994).

## 2026-06-30 13:10

- **Split-view layout regressions fixed.** Removed the always-on active pane highlight in `EditorPaneView.svelte`, centered the tab strip vertically with a 3px left inset (`EditorPaneView.svelte`, `TabBar.svelte`), and tightened markdown mode-bar spacing to ~5px above and below (`app-shell.css`, `MarkdownEditorPane.svelte`).
- **Editor/shell sizing stabilized.** Repaired the editor height chain for empty files by making markdown editor containers flex to full height (`MarkdownEditorPane.svelte`), and removed window-level scrolling by constraining shell/document overflow (`app-shell.css`, `tokens.css`) so only editor/preview panes scroll and the log panel remains visible.

## 2026-06-30 12:29

- **Freeze fixes F4-C + F3-A implemented.** `projectTreeController` now batches child-load updates into fewer publishes by combining children+loading-clear on success, avoiding redundant expand publishes before async loads, and keeping state correctness on failures.
- **Editor remount churn reduced incrementally.** `AppShell` now routes all text documents through a single `MarkdownEditorPane` path, and `MarkdownEditorPane` keeps a single `DocumentEditor` instance across markdown edit/split mode changes (preview-only mode still intentionally renders without the editor).
- **Editor lifecycle diagnostics added.** `EditorSurface` now emits debug diagnostics on mount and destroy to verify remount frequency during tab/mode switching.
- **Validation + plan status updated.** Added F4-C publish-count coverage in `projectTreeController.test.ts`, validated with `npm run check` and full `npm test` (1991/1991), and marked execution-plan items `1.3 F4-C` and `1.4 F3-A` as done.

## 2026-06-30 12:20

- **Freeze fixes F4-A + F4-B implemented.** Added debounce + dedupe to active-file tree expansion (`syncActiveFileTreeExpandEffect`) and pre-filtered already-expanded/loaded ancestors in `projectTreeController.ensureExpandedForActiveFile` to avoid repeat publishes and directory reloads during rapid tab switches.
- **Tab-activation checks now guarded.** `createAppShellFileHandlers.onTabActivated` now skips tab-triggered deferred external checks when tab-activation checks are disabled and throttles repeated checks for the same `documentId` with a short cooldown, while still checking immediately when users switch to a different file tab.
- **Validation coverage expanded.** Added focused tests for active-file expansion debounce/dedupe, project-tree ancestor pre-filtering, and tab-activation check cooldown/settings guards in `appShellEffects.test.ts`, `projectTreeController.test.ts`, and `appShellPageHandlers.test.ts`.
- **Plan status updated.** Marked `specs/text-editor/freeze-fixes-3-4-execution-plan.md` items `1.1 F4-A` and `1.2 F4-B` as done.

## 2026-06-30 — Freeze fixes 3+4 execution plan

- **New plan doc — `specs/text-editor/freeze-fixes-3-4-execution-plan.md`.** Added a dedicated execution plan for the remaining freeze work (fixes 3 and 4), ordered by effort/impact ratio ascending (best ROI first). Includes ROI table, scoped tasks, estimates, risk, exit criteria, validation checklist, and total time budget.

## 2026-06-30 — Freeze mitigation: tree reload dedupe + lazy markdown preview render

- **Project tree reload storms reduced on tab switches.** Split `+page.svelte` effects so `syncProjectTreeWatcherEffect` no longer depends on `activeDocumentPath`; tab changes now only run `syncActiveFileTreeExpandEffect` and do not retrigger root tree loads.
- **Project tree root load dedupe.** `projectTreeController.loadProjectTreeRoot` now skips redundant reloads for the same workspace root (unless `force` is passed), while preserving workspace-access probing for session tabs. `refreshProjectTree` forces a real reload.
- **Markdown preview render made lazy.** `deriveAppShellDocumentView` now renders markdown HTML only when explicitly requested. `+page.svelte` enables it only when the active markdown tab is in `preview` mode, or in `split` mode when split fits. Edit-only markdown tabs avoid synchronous `marked` parse work on tab activation.

## 2026-06-30 — Split view: dark-mode pane background + editor fill fix

- **Split view — white pane background in dark mode fixed.** `EditorGridLayout` introduced in P3 used ad-hoc CSS variables (`--pane-bg`, `--bg-color`) with a `#fff` fallback, so pane cells rendered white regardless of theme. Replaced with app theme tokens (`--color-bg-root`, `--color-border-subtle`, `--color-accent`, etc.) in `EditorGridLayout.svelte` and `EditorPaneView.svelte`.
- **Split view — editor not filling pane fixed.** The P3 grid broke the height chain from `editor-shell` down to CodeMirror: `.pane-body` was a row flex container, `.editor-pane` had no flex growth, and `.editor-host` relied on `height: 100%` without a definite parent height. Fixed by making `.pane-body` / `.editor-pane` column flex containers with `flex: 1`, stretching `.editor-pane-view` to the grid cell, and giving `.editor-host` `flex: 1`.
- **Workspace switch diagnostics.** Added `logDiagnostic` timing for `project tree root load complete`, `restoreWorkspaceSession: sessions loaded` (with session count), and `workspace switch restore complete` / `failed` — to help trace multi-second freezes when opening or switching workspaces.

## 2026-06-30 — Split view: phase-exit review-gate pass

- **Split view (layout groups) — §7 phase-exit checklist closed out.** Ran the 5-item review gate from `split-view-execution-plan.md` §7 across all 7 phases. All items satisfied; one conventions deviation found and fixed.
  - **Conventions audit — `components/EditorPaneView.svelte`.** The pane `<section>`'s `a11y_no_static_element_interactions` warning (pointerdown → `onFocus`, click-anywhere-to-focus) had been carried P3→P7 as "pre-existing." It's an intentional pointer-only convenience with its own keyboard equivalent (`⌘⌥1..4` focus-by-slot, P3), so the convention-matching fix is a `<!-- svelte-ignore a11y_no_static_element_interactions -->` directive — the same pattern already used in `MarkdownEditorPane.svelte` for its intentional pointer-only preview containers. No behavior change.
  - **Checklist items verified.** (1) Conventions — audited; deviation fixed above. (2) Tests green — `npm test` **1983/1983**. (3) Changelog entries — dated entries exist for all 7 phases (P1–P2 through P7). (4) No out-of-scope behavior change — confirmed; the fix is a lint-directive only. (5) P2 parity — already verified at P2 landng (single-pane render byte-for-byte identical to pre-split).
  - **Plan doc — `specs/text-editor/split-view-execution-plan.md`.** §7 checklist items marked done with a dated review-gate-pass note recording the audit and final green state.
  - **Validation — `npm run check` **0 errors / 0 warnings** (was 0/1); `npm test` 1983/1983.**

## 2026-06-30 — Split view P7: persistence (multi-pane layouts survive reload)

- **Split view (layout groups) — Phase 7 implemented (persistence).** Split layouts now survive a reload per context: the restore path preserves the structured multi-pane `EditorLayout` (pane ids, per-pane tab order + selection, `activePaneId`, and the close-reflow `custom` 2-over-1 shape) instead of flattening every pane into one. Previously `sanitizeContext` always collapsed all panes into a single pane via `layoutFromFlatTabs`, so a `cols-2`/`grid-2x2`/`custom` arrangement was lost on restart; the layout kind, geometry, and per-pane tabs now round-trip. Old flat-list snapshots (pre-split-view) still re-seed into a single pane (no persisted migration — AGENTS.md); unrecognizable shapes fall back to a single empty pane.
  - **New pure helper — `domain/editorLayout.ts#restructureEditorLayout(layout, retainTab)`.** The testable core of the restore: it walks each pane, drops tabs that fail a `retainTab` predicate (file tabs whose document isn't in the snapshot, or ephemeral view tabs), clamps each pane's `selectedTabId` to a present tab (Q6 empty-pane survival — a pane that loses every tab stays in place), recomputes the `slots`/`kind` geometry from the surviving pane count via `templateForCount`, and reassigns `activePaneId` to the first pane when it's stale. `normalizeEditorLayout` is now a thin wrapper around it (`retainTab = () => true`). Session tabs are always retained; file tabs missing *on disk* are kept and flagged `fileMissing` (only file tabs whose document is absent from the snapshot are pruned).
  - **`services/sessionSnapshotSanitizer.ts` — multi-pane restore.** `sanitizeContext` gains a structured path: `readIncomingLayout` extracts the `editorLayout` when `panes` is a valid non-empty array (slot reading order and `selectedTabId`/`activePaneId` clamping are left to `restructureEditorLayout`, so a stale/missing `slots` is fine); the per-tab validity predicate flags file-missing docs for retained file tabs then prunes; surviving documents are filtered to those still referenced across all panes (`allTabs`). The legacy flat `openTabs` path is kept verbatim (re-seeds via `layoutFromFlatTabs`); the no-surviving-tabs fallback still builds a single untitled document. `readIncomingTabs`/`readIncomingSelectedTabId` are simplified to legacy-only (their `editorLayout` branches were dead once the structured path took over).
  - **Persist-time correctness — `services/sessionDocumentPersistence.ts#stripViewTabs`.** View tabs (Settings/Themes) are now stripped from **every** pane before serialization (new `removeMatchingTabsFromAllPanes` helper in `editorLayout.ts`), not just the active pane. Previously a view tab sitting in a non-active pane of a split layout would be persisted and then re-pruned on restore — harmless but wasteful and inconsistent with the "view tabs never reopen" invariant.
  - **Validation — `npm run check` 0 errors (1 pre-existing a11y warning in `EditorPaneView.svelte` from P3, unrelated); `npm test` 1983/1983 (+16 vs P5–P6's 1967: 9 new `editorLayout` cases — `restructureEditorLayout` structure-preserve/per-pane-prune/empty-pane-survival/stale-activePaneId/malformed-fallback, `removeMatchingTabsFromAllPanes` strip-from-all/no-op/no-mutation, and a `normalizeEditorLayout` multi-pane case — plus 7 new `sessionManager` split-view-persistence cases — multi-pane round-trip, per-pane missing-doc pruning, stale-activePaneId clamp, malformed-layout single-pane fallback, legacy flat re-seed, per-pane file-missing flagging, `activePane` accessor).** This completes the 7-phase split-view plan.

## 2026-06-29 — Split view P5–P6: tab→pane + file→pane DnD

- **Split view (layout groups) — Phases 5 & 6 implemented.** Both drag-and-drop channels that target panes land together, sharing one cross-pane hit-tester so "which pane is under the pointer" has a single source of truth.
  - **Shared hit-test — `components/paneDropTargets.ts` (new).** `hitTestPaneRects(x, y, panes)` is a pure rect-based core (strip takes priority over body; strips compute a tab drop-index via the same midpoint algorithm as `tabDragController.nextDropIndex`); `collectPaneRects`/`hitTestPaneElements` walk live DOM elements; `collectPaneElementsFromDom` resolves panes by `data-pane-id`/`-strip`/`-body` attributes (used by the project-tree file drag, which lives outside the editor grid's in-memory element registry). Unit-tested with literal rects (no DOM).
  - **Phase 5 — tab→pane DnD.** `tabDragController` gains optional `getPaneId`/`getPaneElements`/`onMoveBetweenPanes` deps and a `dropPaneId` field on `TabDragState`. During a drag it hit-tests every pane; a drop on a *different* pane's strip/body invokes `onMoveBetweenPanes` (always a move — locked default), while a same-pane hit keeps the existing in-strip reorder and a no-pane hit keeps the existing tear-off-to-new-window path (`moveTabFromDrag` unchanged). Gesture discipline (threshold, button-0, no session-tab drag) is identical — only the drop resolution changed. New pure helper `moveTabBetweenPanes(layout, fromPaneId, tabId, toPaneId, toIndex)` in `domain/editorLayout.ts` removes the tab from its origin (recomputing that pane's `selectedTabId`), inserts it into the destination at `toIndex` (clamped; same-pane collapses to a reorder against the post-removal list), and makes the destination the active pane selecting the moved tab (focus follows the drop — P5 exit criterion). Session-tab singleton (Q5) is preserved by construction (the tab is removed before being re-added). Slice action `editorLayoutSlice.moveTabBetweenPanes` wraps it. `EditorGridLayout` owns a pane-element registry (each `EditorPaneView` registers its strip/body on mount via `onRegisterElements`) and a bindable `tabDropTargetPaneId` for the hover affordance; `EditorPaneView` renders `.pane-drop-target` when it's the active tab or file drop target; `TabBar` lifts its cross-pane hover to the grid via `onDropTargetChange`.
  - **Phase 6 — file→pane DnD.** `projectTreeDrag` gains optional `getPaneElements`/`onOpenFileInPane` deps and a `dropPaneId` field; only **file** nodes initiate a pane drag (folder drags keep the existing move-to-folder behavior — click-to-open, rename, move, and select are untouched, the plan's explicit "must not break" guard). In `finishDrop`, a folder target takes priority; otherwise a file drag that lands on a pane calls `onOpenFileInPane`. New slice action `documentContentSlice.openFileInPane(path, content, paneId, contentKind)` mirrors `openFileInTab` but targets a specific pane and enforces the one-document-per-context invariant (Q9): it locates the file's existing tab across **all** panes (via `allTabs` — not just the active pane), steals it from another pane first (`removeTabFromPane`), or focuses it if already in the target, then makes the target pane active. New service `openActivePathInPane` (sibling of `openActivePath`) reuses the same gating (cross-window redirect, large-file confirm) but routes the terminal open through `completeOpenPathInPane` → `appState.openFileInPane`; `describeOpenActivePathResult` is reused. `+page.svelte` holds a shared `fileDropTargetPaneId` state driven by the project-tree drag (`onFileDropPaneChange`) and read by the grid; `getPaneElements` resolves panes from the DOM.
  - **Validation — `npm run check` 0 errors (1 pre-existing a11y warning in `EditorPaneView` from P3); `npm test` 1967/1967 (+31 vs P4's 1936: 12 new `editorLayout` helper cases for `moveTabBetweenPanes`/`removeTabFromPane`/`findTabOwner`, 6 new `editorLayoutSlice` slice cases, 7 new `paneDropTargets` cases, 6 new `projectTreeDrag` cases).** Multi-pane persistence (P7) remains.

## 2026-06-29 — Split view P4: editorRunner + active-document consumers re-pointed

- **Split view (layout groups) — Phase 4 implemented (active-pane routing).** The "long tail": every consumer that reads "the active document" now reaches it through `activePane → activeTab` (Q15/Q16), the editor-routing helpers and sidecar-gating predicate are re-pointed to the **active pane's** selected tab, and `editorRunner` is guaranteed to be bound only to the active pane's editor (no-op for non-editor tabs). Scope per the chosen plan: active-pane routing + `editorRunner` re-bind only — **live per-pane CodeMirror views for non-active panes (up to 4 simultaneous editors) remain deferred** (the plan's flagged dominant risk: memory on huge files + cursor/focus/scroll ownership); non-active panes keep the Phase-3 lightweight placeholder.
  - **`components/editorRouting.ts` — active-pane entry points.** Added `isSessionTabActiveInActivePane(session)` and `activeViewKindInActivePane(session)` that read off `getSessionActiveTab` (activePane → activeTab, Q15). The session-tab singleton invariant (Q5) keeps the sidecar-gating lookup sound across panes — the session tab lives in at most one pane, so checking the active pane's selection is sufficient. The existing `(openTabs, selectedTabId)` overloads are kept as the explicit-values variant (still pinned by the unit test; several callers still pass pre-derived values).
  - **`routes/+page.svelte` — active-pane routing + tightened `activeDocument`.** `isSessionTabActive` / `activeViewTabKind` now use the new entry points taking `session` directly. `activeDocument` no longer falls back to `documents[0]` — session / view tabs and empty panes resolve to `undefined` (a latent footgun now that the split lets any pane show a non-file tab); `deriveAppShellDocumentView(undefined)` degrades to all-false flags + empty status path, which the status bar and editor-surface branches already expect (doc-specific segments are gated behind `!isSessionTabActive && !isChatHttpActive && !isViewTabActive`, all `activeDocument?.` access is optional-chained).
  - **`components/AppShell.svelte` — `editorRunner` re-bind guard.** Phase 3 re-binds the runner by construction (only the active pane mounts `DocumentEditor`/`MarkdownEditorPane`, so a focus change unmounts the old editor and the new one registers on mount). This adds the one missing guarantee: a `$effect` clears `editorRunner = null` whenever `!editor.isTextEditorDocument`, so a stale runner can't leak into commands when the active pane switches to a session/settings/themes/image/binary/large-pending/empty tab. Edit/find/go-to/zoom/wrap handlers already no-op via optional chaining (`getEditorRunner()?.method()`).
  - **No reducer changes** — P1 already made the tab/document slices pane-aware; `getSessionTabs`/`getSessionSelectedTabId`/`getSessionActiveTab` already derive off the active pane. Session sidecar behavior is unchanged (same lookup path, just routed through the active pane).
  - **Validation — `npm run check` 0 errors (1 pre-existing a11y warning in `EditorPaneView.svelte` from P3, unrelated); `npm test` 1936/1936 (+14 vs P3's 1922: 7 new active-pane `editorRouting` cases — multi-pane active-pane reads, empty pane, view-kind across panes — and 6 new `appShellDocumentView` cases incl. the undefined-input degradation, plus the existing 5 `editorRouting` cases preserved).** Tab↔pane DnD (P5), file→pane DnD (P6), and multi-pane persistence (P7) remain.

## 2026-06-29 — Split view P3: multi-pane grid + Layout menu + focus/ring + × close

- **Split view (layout groups) — Phase 3 implemented.** The visible split feature lands. New `components/EditorGridLayout.svelte` renders `layout.slots` as a CSS grid (`grid-template-columns: repeat(maxRowWidth,1fr)`; full-width-span cells get `grid-column: 1 / -1`, which is what produces the close-reflow 2-over-1 shape); new `components/EditorPaneView.svelte` renders each pane's own `TabBar`, a × close button (hidden only at one pane, always visible on empty panes per F3), an active-pane ring (`.editor-pane-view-active`), and a drop-hint empty state (Q6). `AppShell.svelte` swaps its single editor branch for `<EditorGridLayout>`; the active pane renders the existing live editor chrome via a snippet, non-active panes show a placeholder (per-pane live editors — up to 4 CodeMirror instances — are deliberately deferred to P4). New `state/appState/editorLayoutSlice.ts` exposes `setEditorLayout(kind)` (applyPreset, Q2/Q3), `setActiveEditorPane(id)` / `setActiveEditorPaneBySlot(n)` (focus), and `closeEditorPane(id)` (reflowAfterClose: 4→grid / 3→custom-2-over-1 / 2→cols-2 / 1→single, Q7/F1/F2). Commands: `view.layoutSingle`/`view.layoutCols2`/`view.layoutRows2`/`view.layoutRows3`/`view.layoutGrid` + `view.focusPane1..4` (one command id per preset/target, matching the menu/keymap architecture — no payload plumbing), wired in `commands/handlers/view.ts`, `domain/commands.ts` (`AppCommandId`), `commands/definitions.ts` (focus shortcuts ⌘⌥1..4; layout presets have no shortcut per Q14), and `services/appMenuDefinitions.ts` (`View → Layout` submenu at the top of View, separator after — Q13; `custom` is not menu-reachable). CSS: `.editor-shell` is now a flex column; the grid manages its own rows. Verified: tsc 0 errors, svelte-check 0 non-test errors, **1922 tests pass** (incl. 14 new `editorLayoutSlice` tests covering all presets, reflow incl. 2-over-1, focus by id/slot, and selection survival, plus 7 new layout/focus command-dispatch tests in `appViewHandlers`). Tab↔pane and file→pane DnD are P5/P6.

## 2026-06-29 — Split view P1–P2: data model + single-pane parity

- **Split view (layout groups) — Phases 1 & 2 implemented.** Replaced the flat `openTabs`/`selectedTabId` on `SessionState` with a pane-aware `editorLayout: EditorLayout` model (split-view-idea.md §7). New `domain/editorLayout.ts` defines `EditorLayout`/`EditorPane`/`LayoutKind` (`single`/`cols-2`/`rows-2`/`rows-3`/`grid-2x2`/`custom`) with a `slots: number[][]` grid descriptor, and helpers: `createSinglePaneLayout`, `layoutFromFlatTabs` (legacy re-seed), `applyPreset` (Q2/Q3 merge-into-active), `reflowAfterClose` (count-based 4→grid / 3→custom-2-over-1 / 2→cols-2 / 1→single, F1/F2), `mergePaneTabs`, `activePane`/`activeTab`/`getSessionTabs`/`getSessionSelectedTabId` (active-pane derivation, Q15), `selectTabInLayout`, `setActivePaneInLayout`, `normalizeEditorLayout`. Per the chosen hard-replace transition, all reducers and consumers were migrated to read/write through the active pane: `contextHelpers` (clone/reindex/findFileTab), `tabHelpers` (`selectTabInternal`/`reopenTabForDocument`/`closeTabsForce`), `documentTabsSlice`, `documentContentSlice` (`openFileInTab`), `tabTransferSlice`, `workspaceContextsSlice` (`fallbackContextSnapshot`/`ensureContextSnapshotHasTab`), `appState` (initial state), `sessionSnapshotSanitizer` (re-seeds legacy flat-list snapshots on restore; no persisted migration per AGENTS.md), `sessionDocumentPersistence` (`stripViewTabs`), `openFileRegistry`, `relocateWorkspacePaths`, `externalFileChanges`/`-Runtime`, `emptyWindowLifecycle`, `inaccessibleFileTabs`, `documentSave`, `closeTabFlow`, `tabWindowTransfer`, `openFileGate`, `appShellHelpers`/`-AgentHandlers`/`-PageHandlers`, `editorRouting` (unchanged signature, fed active-pane values), command handlers (`app`/`file`/`fileActions`/`registry`), and the UI (`AppShell.svelte` TabBar props, `ActivityRail.svelte` tab counts, `+page.svelte` derived `activeTab`/`isSessionTabActive`/`activeViewTabKind`/notepad-card data). `tabDocumentId` now also accepts `null` (matches `getSessionActiveTab`'s return type); `SyncSessionTabEffectInput.activeTab` widened to `| null`. **Phase 2 renders the new model as exactly one pane** — no visible behavior change. Verified: `tsc` 0 errors, `svelte-check` 0 non-test errors, full suite **1902 tests pass** (incl. 33 new `editorLayout` unit tests covering presetSlots, reflow incl. 2-over-1, applyPreset grow/shrink, merge, normalize, active-pane derivation). Multi-pane grid rendering, the `View → Layout` menu, focus/ring, ×-close, tab↔pane and file→pane DnD, and persistence of multi-pane layouts are later phases.

## 2026-06-29 (late) — Split view: answers resolved + execution plan

- **Split view (layout groups) — answers resolved & execution plan.** Updated `specs/text-editor/split-view-idea.md` (status → Answered; added §7 Resolved decisions table covering all 18 questions + 4 follow-ups, and §8 Known consequences) and added `specs/text-editor/split-view-execution-plan.md`. Locked decisions: per-context `EditorLayout` (`single`/`cols-2`/`rows-2`/`rows-3`/`grid-2x2`/`custom`) replacing flat `openTabs`; × close on each pane with count-based reflow (4→grid, 3→custom 2-over-1, 2→cols-2, 1→single); empty panes allowed; session tabs singleton per context; both tab→pane and file→pane DnD in v1 (pointer-based, unified); one `editorRunner` bound to the active pane; "active document" derived as active-pane→selected-tab; per-context layout persisted, old flat `openTabs` re-seeded to a single pane on restore (no migration). Plan defines 7 phases (data model + reducer → single-pane parity render → multi-pane grid + Layout menu + focus/ring + × close → editorRunner + consumer re-pointing → tab→pane DnD → file→pane DnD → persistence) with ~9.5–14 dev-day estimate, files-touched list, and per-phase exit criteria. **No application code changed.**

## 2026-06-29 15:30

- **Split view (layout groups) — idea doc.** Added `specs/text-editor/split-view-idea.md`. Research-only: documents the requested feature (editor pane split into layout groups — 2 rows / 3 rows / 2 columns / 2×2 grid — each group with its own tab strip supporting both file and session tabs, drag-and-drop of files/tabs into particular groups, and a new `View → Layout` menu), summarizes how the current single-pane editor works (one tab strip per context in `SessionState`, single `TabBar` + editor surface in `AppShell`, single-instance `EditorSurface`/CodeMirror with compartment reconfiguration, pointer-based `tabDragController` with no cross-pane awareness, no file→pane DnD channel today, flat per-context `openTabs` persistence), proposes a pane-based data model (`EditorLayout` + `EditorPane` replacing the flat `openTabs`), a phasing plan, and a rough ~5–8 dev-day estimate. Ends with 18 numbered clarification questions (each with answer options and a ★ recommended answer) covering default/reset layout, tab preservation on shrink, per-context vs global layout, session-tab singleton rules, empty panes, manual close/split vs presets-only, tab↔pane and file→pane DnD scope, duplicate-file-in-panes semantics, pane focus shortcuts, resizable splits, status-bar/Find/GoTo scope, menu placement, shortcuts, the "active document" derivation, `editorRunner` ownership, on-disk persistence shape, and naming. **No code changed.**

## 2026-06-28 08:55

- **Markdown preview/split: raw HTML `<img>` tags now also render.** Markdown image syntax (`![alt](src)`) already rendered after the earlier change, but `<img src=…>` embedded as raw HTML (e.g. README hero blocks like `<p align="center"><img src="hub/.../icon.png" width="250"></p>`) still showed a broken-image icon. Marked passes raw HTML through as opaque `html` tokens, so the existing `walkTokens` hook never visited them.
  - **Raw-HTML post-processing — `services/markdownImageSrc.ts`.** `renderDocumentMarkdown` now post-processes its output with a new `rewriteRawHtmlImageSources`: it matches every `<img …>` tag, extracts the `src` (handling double-quoted / single-quoted / bare value quoting), runs it through the existing `resolveLocalImagePath` → `convertFileSrc`, rewrites the `src` (preserving the original quote style), and stamps `data-md-local-path` for the existing blob fallback. All other attributes (`width`, `alt`, `align`, …) are preserved untouched. It's a no-op for already-rewritten markdown images (passthrough scheme / already-stamped), so running it over the whole output is idempotent and safe.
  - **No component / CSP change needed** — `MarkdownEditorPane.svelte` already queries `img[data-md-local-path]` for its blob fallback, so raw-HTML images are picked up automatically once stamped.
  - **Validation — `npm test` 1869/1869 (+5 cases in `markdownImageSrc.test.ts`: relative src rewrite with `width`/`alt` preserved, the exact `<p align=center>` hero case, remote-src no-op, single-quoted/bare `src`, idempotency); `npm run check` 0/0.**

## 2026-06-28 00:50

- **Activity rail: notepad entry now uses the same button/card layout as workspaces (same sizes, offsets, and vertical spacing).** Previously the notepad entry had its own bespoke button (collapsed) and card (expanded) — different sizes, padding, radius, and gaps than the workspace entries. Both now share the workspace classes so the only differences are content (icon instead of initials; "Tabs: N" / recent-file row instead of name/path/stats).
  - **Uniform vertical spacing — `components/ActivityRail.svelte`.** The three gap sources are now all `--space-2`: `.activity-rail` `gap` (between the notepad entry and the workspaces container), `.rail-workspaces` `gap` (between collapsed workspace buttons), and `.rail-workspaces-expanded` `gap` (between expanded workspace cards). So notepad→workspace spacing equals workspace→workspace spacing, and all entries follow the same top/bottom border padding (no rail top padding; `.activity-rail` and `.activity-rail-expanded` horizontal padding unchanged).
  - **Expanded notepad card reuses `.rail-workspace-card` — `components/ActivityRail.svelte`.** The expanded notepad entry is now a `.rail-workspace-card` (same `min-height: 64px`, `border-radius: --radius-md`, `padding`, flex/gap, hover/active styling as workspace cards). Inside it: a `.rail-workspace-avatar.rail-notepad-avatar` (the same 32×32 accent box, holding the NotepadIcon instead of initials) + a `.rail-workspace-info` column (name "Notepad", a path-line "Tabs: N", and the recent-file row). The old bespoke `.rail-notepad-card*` classes are removed; only `.rail-notepad-avatar` and `.rail-notepad-tab` remain for notepad-specific content.
  - **Collapsed mode already matched** — the notepad entry was already a `.rail-button` (32×32) like workspace buttons; with the gap unification it now also shares identical spacing.
  - **Nested-interaction validity — `components/ActivityRail.svelte`.** The recent-file row renders its trigger as a `<span role="button" tabindex="0">` with click + keydown handlers (nested `<button>`/`<a>` inside the card `<button>` are invalid HTML; the span avoids that while staying keyboard-accessible) and stops propagation so a row click selects that tab without re-triggering the card's select-notepad handler.
  - **Validation — `npm run check` 0/0; `npm test` 1864/1864.**

## 2026-06-27 23:50

- **Activity rail: removed the notepad/workspace separator; expanded notepad card no longer lists untitled files.** Two small rail refinements.
  - **Separator removed — `components/ActivityRail.svelte`.** Dropped the `.rail-divider` element between the notepad entry and the workspace buttons, plus its two CSS rules. The rail's flex `gap` (`--space-2`) now provides the spacing directly, so notepad and workspaces sit as one continuous column in both collapsed and expanded modes.
  - **Untitled files excluded from the expanded notepad card — `routes/+page.svelte`.** `notepadRecentTabs` now filters out docs with no `filePath` (unsaved/untitled), so the "last opened" row only ever lists real on-disk files.
  - **Validation — `npm run check` 0/0; `npm test` 1864/1864 (CSS + a filter predicate; no behavioral test fixtures changed).**

## 2026-06-27 23:35

- **Fix: notepad-rail vertical reduction now actually applies (collapsed mode).** The earlier change targeted only `.activity-rail-expanded` and the expanded notepad card, but the rail is collapsed (48px) on fresh installs / common windows — the `.rail-notepad-card` never renders there, so the prior edits had no visible effect. The fix moves the reduction onto the **base** `.activity-rail` rule that applies in collapsed mode (`components/ActivityRail.svelte`): top `padding` `var(--space-8)` → `0` and flex `gap` `var(--space-6)` → `var(--space-2)`. This removes ~28px from the notepad region (rail top → divider drops from ~65px to ~37px), pulling the divider down to ≈ the editor tab-bar bottom line (`--tab-header-height`). Expanded mode keeps its own (already-tight) padding/gap, so it's unaffected.
  - **Validation — `npm run check` 0/0; `npm test` 1864/1864 (CSS-only, no behavioral change).**

## 2026-06-27 23:00

- **Fresh-install polish: `turnip` theme default, tighter notepad rail, relocated session import action, and a denser/wider project pane.** A bundle of UI density and default-experience tweaks aimed at the out-of-the-box first impression.
  - **`turnip` is now the default theme on fresh installs — `services/themeStore.ts`.** The curated `turnip` preset (a dark theme) already existed in `IMPORTED_THEMES`; it now seeds the `darkTheme` and `manualTheme` slots of `defaultThemeFile` (the `lightTheme` slot stays `light-blue`). New constants `DEFAULT_DARK`/`DEFAULT_MANUAL` (preset refs) keep the builtin-fallback constants (`DEFAULT_DARK_BUILTIN` etc.) intact for invalid-ref recovery. Per AGENTS.md, no migration — existing users keep whatever their `theme.json` already pins; only brand-new installs (no `theme.json`) land on turnip.
  - **Notepad rail card halved vertically — `routes/+page.svelte` + `components/ActivityRail.svelte`.** The expanded notepad card now shows only the single most-recently-opened file tab (was last-3), and the card's internal padding/gap are tightened (`--space-1` instead of `--space-2`), so the card is roughly half its prior height and its divider sits near the editor tab-bar bottom line.
  - **Sessions sidebar: import action moved above the search field and renamed — `components/SessionsSidebar.svelte`.** The "All sessions…" button is removed from the header and re-rendered inside the sidebar body, above the "Search sessions" field, as a full-width "Import OpenCode Sessions" button (new `.sessions-sidebar-import` style in `styles/sessions-sidebar.css`). Same `onOpenSessions` handler; only placement and label change.
  - **Project pane density pass — `components/ProjectTreeNode.svelte` + `components/ProjectTreeView.svelte`.** Row horizontal `gap` reduced `--space-6` → `--space-3` (halves the chevron↔icon↔label spacing); `min-height` reduced `22px` → `19px` (~15% tighter vertical rhythm); left content offset reduced by ~70% (row `padding-left` `--space-6` → `--space-2`, tree-view padding `--space-6` → `--space-2`). The `--tree-indent` per-depth value is unchanged.
  - **Default project pane width +~15% — `services/panelLayout.ts` + `styles/tokens.css` + `components/ProjectPanel.svelte`.** New `DEFAULT_PROJECT_PANEL_WIDTH_PX` = `round(240 * 1.15)` = 276, used by `defaultWorkspaceLayout` for `projectPanelWidthPx` (the sessions sidebar keeps the 240 default) and by `ProjectPanel`'s `panelWidthPx` prop default; the `--project-panel-width` CSS token is bumped 240 → 276 to match.
  - **Validation — `npm run check` 0/0; `npm test` 1864/1864 (updated `panelLayout.test.ts` for the new project default; updated `settingsSlice.test.ts` for the turnip default: initial `darkTheme`, `cycleTheme` next-ref now `tron` instead of `light-blue`, and `applyPersistedSettings` default id).**

## 2026-06-27 22:05

- **Activity rail is now always shown** (previously it auto-hid when Notepad was the only open context and no workspaces existed). The rail — home to the Notepad button, the new Notepad expanded card, and the workspace buttons — is now always rendered so its features are reachable in every state, including the notepad-only default state.
  - Removed the `hideActivityRailWhenNotepadOnly` setting end-to-end: the `AppSettingsState` field (`domain/settings.ts`), its default and partial-apply branch (`state/appState/settingsSlice.ts`), the `appState.setHideActivityRailWhenNotepadOnly` setter (`state/appState.ts`), persisted-settings read/parse/write in `services/settingsStore.ts` (+ `settingsStore.test.ts` fixture), the `applyPersistedSettings` mapping (`services/appShellRuntime.ts`) and the save mapping (`services/appShellEffects.ts`), and the "Layout → Hide activity rail when Notepad only" checkbox (`components/settings/EditorSettingsPanel.svelte`). `+page.svelte` now passes `show: true` directly to the `activityRail` prop instead of computing a `showActivityRail` derived. Per AGENTS.md, no migration — old `settings.json` files with the now-removed key are simply ignored by the parser.
  - Validation: `npm run check` 0/0; `npm test` 1864/1864.

## 2026-06-27 19:15

- **Activity rail: window-scoped expand/collapse + resize state, earlier expand threshold, and an expanded Notepad card.** The modes/workspaces sidebar (activity rail) now keeps its own expanded/collapsed state and width independent of which mode or workspace is selected — previously the width lived per-workspace and was dropped whenever Notepad was active, so resizing the rail and switching contexts reset it. The expanded state also appears earlier, and the Notepad rail entry gains its own expanded card (tab count + last-3 opened tabs) plus a system notepad icon in collapsed mode.
  - **State scope — window-level, independent of mode/workspace.** `activityRailWidthPx` moves off the per-workspace `WorkspaceLayoutState` (`domain/workspace.ts`) onto the top-level `AppDomainState` and is persisted in the per-window `WindowSessionSnapshot` (`domain/persistence.ts`), so each window remembers its own rail width and it survives notepad/chat/workspace switches. New `appState.setActivityRailWidth(width)` / `getSnapshot().activityRailWidthPx` replace the per-workspace write path. `updateActiveWorkspaceLayout` drops the Notepad no-op guard it needed when the rail width rode on workspace layout. `panelLayout.ts` `defaultWorkspaceLayout`/`normalizeWorkspaceLayout` no longer carry the rail field. Per AGENTS.md, no migration: old `session.json` files (which had `layout.activityRailWidthPx`) re-seed the 48px default.
  - **Earlier expand — `services/panelLayout.ts`.** `ACTIVITY_RAIL_EXPANDED_THRESHOLD_PX` lowered from `MAX/2` (260px, 50%) to `MAX * 0.2` (104px, ~20%) so the expanded info cards appear as soon as the rail is dragged out about a fifth of its max width.
  - **Notepad icon (collapsed) — `components/icons/NotepadIcon.svelte` (new).** A system-style notepad glyph (pad body + binder strip + text lines) following the `FileIcon`/`DirectoryIcon` convention (`size` prop, 16×16 viewBox, `stroke="currentColor"`). Replaces the literal `N` in the collapsed Notepad rail button.
  - **Expanded Notepad card — `components/ActivityRail.svelte`.** When expanded, the Notepad entry renders as a card (mirroring the workspace cards): a header row with the notepad icon, "Notepad" label, and `Tabs: N` count, plus a vertical list of the last 3 opened file tabs (append order, newest-opened last) formatted as `<parent-folder>/<filename.ext>`. Each tab is a clickable button that switches to the Notepad context and selects that tab (`switchContext("notepad")` + `selectTab`). New `ActivityRail` props `notepadOpenTabCount` / `notepadRecentTabs` / `onSelectNotepadTab`, threaded through `AppShell.svelte` `AppShellActivityRailProps` and derived in `+page.svelte` from `snapshot.contexts.notepad`.
  - **Label helper — `services/notepadTabLabel.ts` (new).** `formatNotepadTabLabel(filePath, title)` produces `parent/file.ext` from a document path (last two segments; falls back to filename for root paths, to `title`/"Untitled" for unsaved docs). Pure string ops (no Tauri async path APIs) so it runs inside a synchronous `$derived`, mirroring the `basename` helper.
  - **Validation — `npm test` 1864/1864 (updated `panelLayout.test.ts` for the new 20% threshold and the dropped layout field; dropped `activityRailWidthPx` from `WorkspaceLayoutState` fixtures in `appShellHelpers.test.ts`/`workspaceContextsSlice.test.ts`; added `activityRailWidthPx: 48` to hand-built `AppDomainState` literals in `appShellHelpers`/`openFileRegistry`/`windowManager`/`contextHelpers` tests; added a "rail width survives context switch" case in `workspaceContextsSlice.test.ts`; new `notepadTabLabel.test.ts`); `npm run check` 0/0.**

## 2026-06-27 18:00

- **Markdown preview/split: images now render.** Previously every image in a `.md` document's **preview** and **split** modes was broken — relative paths resolved against the app origin instead of the document's folder, `file://`/remote URLs were CSP-blocked, and there was no `img` styling so even a loaded image overflowed the pane. All layers are fixed so local and remote images render inline in both modes.
  - **Image-source rewriting — `services/markdownImageSrc.ts` (new).** `resolveLocalImagePath(href, documentFilePath)` maps a markdown image href to a filesystem path: `http(s):`/`data:`/`blob:`/`asset:` URLs return null (passthrough); `file://` is decoded; absolute paths are used as-is; relative paths are joined against the document's directory (pure string ops — this runs inside a synchronous `$derived`, so Tauri's async `path` APIs can't be used); unsaved docs return null. `renderDocumentMarkdown(content, documentFilePath)` owns an isolated `new Marked()` with a `walkTokens` hook that rewrites image-token `href` to a `convertFileSrc()` URL and a custom `image` renderer that also stamps the resolved local path onto the `<img>` as `data-md-local-path`. Isolated instance so it never disturbs the global `marked` that `chatMarkdown.ts` configures.
  - **Blob fallback — `components/MarkdownEditorPane.svelte`.** The asset-protocol `src` alone proved unreliable in `tauri dev`, so the component mirrors `ImagePreviewPane.svelte`'s proven fallback: after the preview HTML is (re)injected it walks each `img[data-md-local-path]` and attaches a CSP-safe `addEventListener("error", …)` (inline `onerror=` would be blocked by `script-src`) that reads the file via the `fs` plugin and swaps the `src` to a `blob:` URL. Object URLs are revoked when the document changes and on destroy. This is what makes local images actually appear.
  - **Rendering — `services/appShellDocumentView.ts`.** Replaced the bare `marked.parse(content)` call with `renderDocumentMarkdown(content, filePath ?? null)`; the `marked` import is dropped.
  - **CSP — `src-tauri/tauri.conf.json`.** `img-src` now also admits `http:` and `https:` so remote images (README badges, doc-site images) render. (Consistent side effect: chat images from remote URLs now render where they were previously CSP-blocked.) Inline event handlers stay blocked by the existing `script-src` fallback to `default-src 'self'`, so the image-error fallback is attached via `addEventListener`, not an inline attribute.
  - **CSS — `components/MarkdownEditorPane.svelte`.** New `.markdown-preview :global(img)` rule (`max-width: 100%; border-radius`), mirroring the existing `.chat-prose img` rule, so images fit the pane instead of overflowing.
  - **Validation — `npm test` 1858/1858 (+ new `markdownImageSrc.test.ts`: local-path resolution, passthrough schemes, end-to-end `marked` render with `src` rewrite + `data-md-local-path` stamping, title/escaping); `npm run check` 0/0.**

## 2026-06-27 17:00

- **Themes: simplified to Auto + Manual modes (dropped Light/Dark).** The mode selector now offers only `Auto` and `Manual`. `Auto` follows the OS `prefers-color-scheme` and switches between the user's chosen dark and light themes (the existing two slots). `Manual` pins a single theme regardless of OS — the user picks exactly one from the combined list of all themes (builtins + presets + customs). New installs/resets still default to `auto`.
  - **Data model — `domain/settings.ts` `ThemeMode` + `AppThemeState`.** `ThemeMode` is now `"auto" | "manual"` (was `"dark" | "light" | "auto"`). `AppThemeState` gains a `manualTheme: ActiveThemeRef` field pinned when `mode==="manual"`; `darkTheme`/`lightTheme` are still the two themes `auto` switches between.
  - **Persistence — `services/themeStore.ts` `ThemeFileV2`.** Adds `manualTheme` to the v2 schema and `defaultThemeFile` (defaults to `dark-amber`). `isThemeMode` now accepts only `auto`/`manual` (any old `dark`/`light` value silently normalizes to `auto`). `normalizeThemeFile`/`parseThemeFile` validate `manualTheme` against builtin/preset/custom ids and fall back to `DEFAULT_MANUAL_BUILTIN` on unknown/missing refs; the V1→V2 seed and the `settings.json` migration seed both default `manualTheme` to `dark-amber`. No data migration (per AGENTS.md): pre-field files just re-seed the default.
  - **Controller — `state/appState/themeController.ts`.** `resolveActiveTheme` now branches `manual`→`manualTheme`, `auto`→OS-pref slot (the old dark/light pinned branches are removed). `defaultThemeState`/`toThemeFile` carry `manualTheme`.
  - **Store actions — `state/appState.ts`.** New `setManualTheme(ref)` mirrors `setDarkTheme`/`setLightTheme`. `cycleTheme` (⌘U) is rewritten: instead of toggling dark↔light, it cycles to the next theme in a stable builtin→preset→custom order and switches to `manual` mode, so the shortcut immediately renders a different theme. `updateCustomThemeToken` now uses `resolveActiveTheme(theme)` to decide whether to re-apply (fixes a latent bug where token edits wouldn't live-refresh in auto mode). `applySystemPrefersDark` still re-applies only in `auto` mode.
  - **UI — `components/ThemesView.svelte`.** Mode segmented control is now `Manual` / `Auto` (two buttons). In `manual` mode a single combined "Theme" radio group lists every theme with single selection → `setManualTheme`. In `auto` mode the existing Light/Dark pickers remain, with an updated hint: "Auto follows your system appearance (dark/light). Pick the two themes to switch between below." The custom-theme editor targets the effective theme in both modes (`manualTheme` in manual, OS-pref slot in auto).
  - **Validation — `npm test` 1843/1843 (rewrote `themeController` resolve/apply cases for the manual branch; updated `settingsSlice` `setThemeMode`/`cycleTheme`, `appViewHandlers` `view.cycleTheme`, and `themeStore`/`contextHelpers`/`openFileRegistry` fixtures for the new `manualTheme` field and modes); `npm run check` 0/0.**

## 2026-06-27 15:00

- **Themes: auto mode that follows the OS light/dark preference, with separate dark/light theme picks.** Adds a `mode` (`dark`/`light`/`auto`) to the theme state. `auto` follows the OS `prefers-color-scheme` media query and switches between the user's chosen dark and light themes; `dark`/`light` pin the mode regardless of OS. New installs and resets default to `auto` (dark-amber for dark, light-blue for light).
  - **Data model — `domain/settings.ts` `AppThemeState` + `ThemeMode`.** `activeTheme` is now derived, not stored. The state holds `mode`, `darkTheme`, `lightTheme` (each an `ActiveThemeRef`), and `customThemes`. Effective theme = `mode==="dark" ? darkTheme : mode==="light" ? lightTheme : (systemPrefersDark ? darkTheme : lightTheme)`. Mirrors VS Code's `preferredDark/LightColorTheme` + `autoDetectColorScheme` model.
  - **Persistence — `services/themeStore.ts` `ThemeFileV2`.** `theme.json` moves to `version: 2` with `mode`/`darkTheme`/`lightTheme`/`customThemes`. `parseThemeFile` accepts both v2 (canonical) and v1 (legacy) payloads; v1 is defensively seeded to v2 by slotting the old single `activeTheme` into its matching dark/light slot (mode defaults to `auto`). The pre-`theme.json` `settings.json` `theme`/`themeMode`+`accent` seeding path now also seeds a v2 file. `normalizeThemeFile` validates both slots against builtin/preset/custom ids, falling back to the mode-appropriate builtin on any unknown ref.
  - **Scope discipline — no data migrations (per AGENTS.md).** Old `theme.json` files are re-seeded to defaults on load, not migrated: a legacy activeTheme is opportunistically placed into its matching dark/light slot so a previously-selected custom dark theme isn't dropped, but no migration code is written.
  - **Controller — `state/appState/themeController.ts`.** New `resolveActiveTheme(theme, prefersDark)` resolves the effective ref; `applyThemeState(theme, prefersDark?)` threads through it (the DOM bridge `root.dataset.theme` always lands on a concrete `dark`/`light`, so no CSS rule changes). `baseModeForTheme` is replaced by `baseModeForRef(ref, customThemes)` (the ref's own dark/light, independent of mode). New `subscribeSystemColorScheme(onChange)` wraps `window.matchMedia("(prefers-color-scheme: dark)")` with cleanup; module-level `getSystemPrefersDark`/`setSystemPrefersDark` mirror the current OS preference (defaults to dark when `matchMedia` is unavailable, e.g. jsdom).
  - **Store actions — `state/appState.ts`.** `setThemeMode(mode)`, `setDarkTheme(ref)`, `setLightTheme(ref)` are the new primary setters. `setActiveTheme(ref)` is kept as a convenience that routes a ref to whichever slot matches its baseMode (used by the custom-theme editor flow). `cycleTheme` now toggles the effective mode dark↔light (was: flip between the two builtins). `applySystemPrefersDark(value)` re-applies only when `mode==="auto"`. `deleteCustomTheme` resets whichever slot held the deleted custom to its builtin default.
  - **OS listener — `services/appShellRuntime.ts`.** Subscribes to `subscribeSystemColorScheme` right after `loadTheme()` in the `load-settings` startup phase, pushing the unlisten into the existing `cleanupCallbacks` array so it's torn down on shutdown.
  - **UI — `components/ThemesView.svelte`.** Replaces the single flat radio group with a Light/Dark/Auto segmented control plus two grouped pickers: "Light theme" (light themes only) and "Dark theme" (dark themes only), each constrained to its slot's mode so auto-switching always lands correctly. The custom-theme token editor binds to the currently effective custom theme (resolves the auto slot from the live OS preference). New `.theme-mode-segmented` control styled with themeable tokens.
  - **Validation — `npm test` 1844/1844 (rewrote `themeStore.test.ts`/`themeController.test.ts` for v2 + auto mode; added `resolveActiveTheme` matrix, `matchMedia` subscription, and v1-seeding cases; updated `settingsSlice`/`appViewHandlers`/`contextHelpers`/`openFileRegistry` fixtures); `npm run check` 0/0.**

## 2026-06-27 09:00

- **Tab context menu: "Remove" deletes a file from disk and closes its tab.** Adds a "Remove" item to the file-tab right-click menu (alongside Rename) that deletes the underlying file from disk and closes the tab. Reuses the existing `deleteProjectEntry` pipeline from `projectFileOps.ts` — the same one the project tree's Delete uses — so the file is removed via Tauri's `remove`, the document's tab is closed by `closeTabsForDeletedDocumentsUnderPath`, and the project tree refreshes via the filesystem watcher. No separate close logic needed.
  - **Predicate — `services/tabContextMenuActions.ts` `canDeleteTabFile`.** Enabled only for on-disk files inside the active workspace root (mirrors the `isPathUnderRoot` guard in `deleteProjectEntry`); unsaved/untitled docs and files outside the workspace are excluded. Takes `workspaceRoot` as a parameter (matching the pure-predicate convention of `canCopyRelativePath`) so it stays unit-testable without mocking appState. Missing files are still allowed — they may be on disk under the same path, and a failed removal surfaces a clear reason.
  - **Handler — `services/tabContextMenuActions.ts` `deleteContextTabFile`.** Shows a `confirm()` dialog (`Delete file "<name>"?`, warning kind) before calling `deleteProjectEntry(workspaceRoot, filePath)`; reports the result via `notify` and closes the menu. Follows the `renameContextTab` try/finally → `closeContextMenu` shape.
  - **UI — `components/TabBarContextMenu.svelte`.** New "Remove" item, gated by `contextMenuCanDelete`, styled with a new `tab-context-item-danger` class (`styles/tab-context-menu.css`, reusing the `--color-danger` token already used by the project-tree/sessions danger variants). Placed directly under the Rename block.
  - **Validation — `npm test` 1831/1831 (+1 new `canDeleteTabFile` case in `tabContextMenuActions.test.ts`); `npm run check` 0/0.**

## 2026-06-25 22:20

- **Themes: imported preset catalog + gradient backgrounds.** Two additive theme features shipped together.
  - **Preset catalog — `styles/importedThemes.ts` (generated), `styles/convertVscodeTheme.ts`.** Adds a third, read-only theme category alongside built-ins and custom themes: 12 presets converted from the [daylerees colour-schemes](https://github.com/daylerees/colour-schemes) vscode export (`zacks, yule, turnip, tron, tribal, tonic, super, stark, sourlick, solarflare` + `github` light + `darkside`). Surfaced as a "Presets" radio section in `ThemesView.svelte`; selecting one calls `setActiveTheme({ kind: "preset", id })`. Presets are not written to `theme.json` and have no token editor (read-only — duplicate via "+ New theme" to edit).
    - **Converter — `convertVscodeTheme.ts`.** Maps the vscode theme shape (6 `colors` keys + TextMate `tokenColors` scopes) onto our 29-token schema. Direct mappings: `editor.background`→`color-bg-root`/`color-surface-1`, `editor.foreground`→`color-text-primary`, etc. Syntax scopes → `syntax-*` tokens (string-or-array scopes, first match wins; `markup` narrowed to inline-emphasis scopes to exclude the shared diff `#00a8c6`). The ~14 uncovered tokens derive via `color-mix` expressions; accent is the most-saturated hex among identity scopes (keyword/string/number/type/heading) so each preset gets a distinct, theme-appropriate accent. `baseMode` comes from the manifest `uiTheme`.
    - **Generator script — `scripts/import-daylerees-themes.mjs`.** Dependency-free Node ESM that reads the curated subset from a source path and (re)writes `importedThemes.ts`. Mirrors the converter logic; run with `node app/scripts/import-daylerees-themes.mjs <path-to-colour-schemes-master/vscode>`.
    - **`ActiveThemeRef` preset kind — `services/themeStore.ts`, `state/appState/themeController.ts`.** Adds `| { kind: "preset"; id: string }` (additive; old `theme.json` unaffected). `normalizeActiveTheme`/`normalizeThemeFile` validate the id against `IMPORTED_THEMES`; an unknown preset id (removed in a future curated set) falls back to the default builtin rather than crashing. `applyThemeState`/`baseModeForTheme`/`fallbackBuiltinForTheme` gained preset branches.
  - **Gradient backgrounds — `styles/themeTokens.ts`, `styles/tokens.css`.** The five background-surface tokens (`color-bg-root`, `color-surface-1`, `color-surface-overlay`, `color-statusbar-bg`, `scrollbar-track`) now accept CSS gradients. New `GRADIENT_CAPABLE_KEYS` set + `extractSolidColor` helper extract the first color stop so the `color-mix` surface derivatives (`--color-surface-0/2`) — which can't accept a gradient — keep resolving. `applyCustomTheme`/`applyBuiltinTheme` now write a paired `--<key>-solid` var for each gradient-capable token; `tokens.css` reads the `-solid` variants in both light/dark blocks. Accent/text/syntax tokens stay solid (they feed `color-mix` or render as swatches).
    - **UI — `components/ThemesView.svelte`.** The per-token color picker runs gradient-capable values through `extractSolidColor` so it shows the gradient's base solid; the free-text field still accepts any CSS string (gradients go here). Added a one-line hint on the "background" group.
  - **Docs.** Fixed pre-existing `docs/architecture.md` typo (`themes.json` → `theme.json`) and noted the preset catalog ships in-app.
  - **Scope discipline — no data migrations (per AGENTS.md).** Preset `activeTheme` refs validate against the in-app catalog; gradient support needs no schema change (gradients are CSS strings in the existing `tokens` map).
  - **Validation — `npm test` 1830/1830 (was 1799; new suites `convertVscodeTheme` 12, `importedThemes` 5, `themeController` preset 4, plus `themes` gradient/solid cases and `themeStore` preset round-trip cases); `npm run check` 0/0.**

## 2026-06-25 17:20

- **Sidebar / activity-rail UI polish + resizable workspaces rail.** Five layout/visual changes across the left rail and project panel.
  - **Removed the "Sessions" title text** from the sessions sidebar header (`SessionsSidebar.svelte`). The collapse toggle, New/Cats, and "All sessions…" buttons remain; `sidebarTitle` is still used for the `aria-label` and the chats-vs-sessions button-label derivation.
  - **Compacted the project tree (~25% tighter pitch).** `ProjectTreeList.svelte` list `gap` `--space-2` → `--space-1`; `ProjectTreeNode.svelte` row `min-height` 24px → 22px. Item pitch drops from ~28px to ~24px.
  - **Added a subtle separator** between the Notepad/Chat modes and the workspaces list in `ActivityRail.svelte` — a short `1px` line (24px wide, 100% in expanded mode) at `color-mix(in srgb, var(--color-border-subtle) 60%, transparent)`.
  - **Fixed the workspace-widget highlight clipping.** Root cause: the rail's horizontal padding (12px each side) left only 24px of content for 32px buttons, so the active highlight was visually clipped at both edges. Reduced horizontal padding to `--space-1` so the 32px square (36px in expanded mode) active buttons render as clean rounded squares. The active state keeps its accent border + tint + inset ring.
  - **Made the activity rail resizable with two widget states.** New persisted per-workspace `activityRailWidthPx` on `WorkspaceLayoutState`. Bounds: `MIN_ACTIVITY_RAIL_WIDTH_PX = 48` (compact), `MAX_ACTIVITY_RAIL_WIDTH_PX = 520` (same as the project panel); `ACTIVITY_RAIL_EXPANDED_THRESHOLD_PX = round(520/2) = 260`. A right-edge resize handle (`ActivityRail.svelte`) grows/shrinks the rail; the width is committed via `handleActivityRailWidthChange` (`appShellLayoutHandlers.ts`) → `appState.updateActiveWorkspaceLayout({ activityRailWidthPx })`.
    - **Compact state** (< 260px): unchanged 32px letter buttons + tooltips.
    - **Expanded state** (≥ 260px): full-width info cards (~2× taller), each with a letter avatar, full workspace name, path (both truncated with ellipsis), and two stat lines — `Sessions: N` (from the chatStore workspaces map, keyed by root path) and `Tabs: N` (from the workspace entry's session snapshot `openTabs.length`). Cards stretch to fill the available width minus offsets.
  - **Wiring.** `AppShell.svelte` `AppShellActivityRailProps` gains `panelWidthPx` + `onPanelWidthChange`; `+page.svelte` feeds `workspaceLayout.activityRailWidthPx` and `handleActivityRailWidthChange`. `panelLayout.ts` adds `DEFAULT/MIN/MAX_ACTIVITY_RAIL_WIDTH_PX`, `ACTIVITY_RAIL_EXPANDED_THRESHOLD_PX`, `normalizeActivityRailWidthPx`, `isActivityRailExpanded`, and the field in `defaultWorkspaceLayout`/`normalizeWorkspaceLayout`.
  - **Scope discipline — no data migrations (per AGENTS.md).** Pre-change snapshots lacking `activityRailWidthPx` fall back to the 48px default via `normalizeWorkspaceLayout`.
  - **Validation — `npm test` 1799/1799 (+3 new `panelLayout` cases: activity-rail clamping, expanded-threshold, explicit-width normalization; fixtures in `appShellHelpers.test.ts`/`workspaceContextsSlice.test.ts` updated for the new required field); `npm run check` 0/0.**

## 2026-06-25 14:15

- **Settings & Themes as editor-pane tabs (not popups/panels).** Moves **Themes** into the **SpecOps** app menu (above **Settings**) and converts both Settings and Themes from overlays (a modal dialog and a slide-in panel) into first-class tabs that render inside the editor pane (notepad mode), so opening either creates/focuses a tab just like a file or session tab.
  - **New tab kind — `domain/document.ts`, `domain/contracts.ts`.** Adds `ViewTabState { id; kind: "view"; view: "settings" | "themes"; pinned; subTab? }` to the `TabState` union, with `isViewTab` guard, `createViewTab` constructor, and `normalizeTabState`/`tabDocumentId` widened to pass view tabs through. `subTab` carries a settings deep-link target (e.g. `"connections"`) for `openSettingsDialog(tab)`.
  - **Open action — `state/appState/documentTabsSlice.ts`.** `openOrFocusViewTab(view, subTab?)` mirrors `openOrFocusSessionTab`: focus-or-create singleton semantics in the active session's tab strip. Exposed on the root store as `appState.openOrFocusViewTab(...)`.
  - **Command repoint — `commands/handlers/app.ts`.** `app.toggleSettings` and `app.toggleThemePane` now call `appState.openOrFocusViewTab(...)` instead of toggling overlay state. The settings deep-link opener (`registerSettingsDialogOpener` in `appShellPageHandlers.ts`) routes `openSettingsDialog(tab)` → `appState.openOrFocusViewTab("settings", tab)`, preserving deep-links from `ChatBlockedState` / `StatusPopover`.
  - **Chrome-less view components — `components/settings/SettingsView.svelte` (new), `components/ThemesView.svelte` (new).** The Settings body (sidebar + section panels) extracted out of the legacy dialog; Themes content extracted out of the legacy `<aside>`. Sub-panels keep their refresh-on-open behavior by receiving `dialogOpen={true}` (the view is mounted only while its tab is active). `SettingsView` honors the `subTab` deep-link via `resolveOpenSettingsDialogTab`.
  - **Routing — `components/editorRouting.ts` (+`activeViewKind`), `routes/+page.svelte` (`isSettingsViewActive`/`isThemesViewActive`/`isViewTabActive` derivations), `components/AppShell.svelte`.** Editor pane renders `<SettingsView>` / `<ThemesView>` as leading branches; status-bar document segments and the Find/GoTo floating tools are suppressed for view tabs. `TabBar.svelte` titles view tabs "Settings"/"Themes".
  - **Menu — `services/appMenuDefinitions.ts`.** SpecOps submenu gains **Themes** (⌘⇧,) above **Settings** (⌘,); the redundant "Settings…" item was removed from the File menu. `commands/definitions.ts` `app.toggleThemePane` now has a binding + `SpecOps/Themes` menuPath.
  - **Ephemeral persistence — `services/sessionDocumentPersistence.ts`, `sessionSnapshotSanitizer.ts`.** View tabs are stripped from every context's `openTabs` on save (`stripWindowSnapshotForSession`) and dropped on restore (`sessionSnapshotSanitizer`), with `selectedTabId` reseated to a remaining tab. View tabs never reopen after restart.
  - **Removed dead code.** Deleted `SettingsDialog.svelte`, `ThemePane.svelte`, `settings/SettingsDialogMeasure.svelte`, `settings/settingsDialogChrome.ts` (+test), `services/settingsDialogGeometry.ts` (+test), `styles/settingsDialogChrome.css`. Trimmed `CommandContext` and `AppShellCommandHandlersDeps` of `*ThemePaneOpen`/`*SettingsDialogOpen` fields; dropped the now-obsolete `handleKeydown` dialog-open gate and the "Theme" toolbar button.
  - **Cross-window transfer** — view tabs carry no document/session, so `tabDocumentId` returns null and the transfer/dirty paths (`buildTabTransferPayload`, `transferActiveTabOut`, `closeTabWithPrompt`) treat them as non-dirty, non-transferable; "Move Tab To New Window" is a safe no-op for a view tab.
  - **Tests** — `npm test` 1796/1796 (+4: `editorRouting` view-kind, `documentTabsSlice` focus-or-create + sub-tab, `sessionDocumentPersistence` view-tab strip + selection reseat); `npm run check` 0/0. Updated `createCommandContext` fixtures in 5 handler test files; the toggle tests now assert view-tab creation.
  - **Scope discipline — no data migrations (per AGENTS.md).** Legacy snapshots with no view tabs are unaffected; the strip/restore guards are additive.

## 2026-06-24 23:45

- **Phase 3.5 M16 — Internal session rename (code & persistence) (completed).** Removes the implementation-level **agent** vocabulary for workspace **conversations**, renaming domain types, chat store, app-state tabs, components, tab kinds, persistence paths/envelope keys, handlers, effects, and diagnostics so code matches the user-facing **Session** model from M15. OpenCode **persona** symbols keep **agent** (`opencodeAgentId`, Settings → Agents, `@agent:` tokens, the `WorkspaceAgentBackend` / `workspaceAgentBackend.ts` SDK bridge). Indexed in `execution-plan.md` as M16. **Breaking disk-layout change — no migration shim (pre-release, per AGENTS.md).**
  - **Domain (M16-T1) — `domain/chat.ts`, `domain/document.ts`, `domain/workspace.ts`, `domain/contracts.ts`.** `AgentIndexEntry` → `SessionIndexEntry`; `WorkspaceAgentsIndexSnapshot` → `WorkspaceSessionsIndexSnapshot` (envelope key `agents` → `sessions`); `ChatAgentThreadFileSnapshot` → `ChatSessionThreadFileSnapshot`; `ChatThreadMetadata.agentId` → `sessionId` (`opencodeAgentId` persona field unchanged); `AgentTabState` → `SessionTabState` with tab `kind` `"agent"` → `"session"` and `tab.agentId` → `tab.sessionId`; `isAgentTab`/`createAgentTab` → `isSessionTab`/`createSessionTab`; `SessionState.lastActiveAgentId` → `lastActiveSessionId`; `WorkspaceLayoutState.agentsSidebarWidthPx`/`agentsSidebarCollapsed` → `sessionsSidebar*`. `normalizeTabState` still tolerates legacy `"agent"` tabs (window-snapshot safety) but the chat layout itself was reset.
  - **chatStore (M16-T2) — `state/chatStore/`.** `agents.ts` → `sessions.ts` (`createAgentsSlice` → `createSessionsSlice`); `WorkspaceAgentsState` → `WorkspaceSessionsState`; `activeAgentId`/`agentIndex`/`threadsByAgentId`/`runtimeByAgentId` → `activeSessionId`/`sessionIndex`/`threadsBySessionId`/`runtimeBySessionId`. Public store API: `getActiveSessionId`, `setActiveSessionId`, `createDraftSession`, `isSessionDraft`, `getSessionTitle`, `getSessionIndex`, `getSessionLink`, `setSessionLink`, `clearSessionLink`, `renameSession`, `forkSession`, `getWorkspaceSessionsState`, `loadWorkspaceSessions`, `mergeSessionDrafts`, `deleteSession`, `cancelSessionGeneration`, `createSessionId`/`resetSessionIdCounterForTests` (ids now `session-N`). Barrel + derived stores: `chatSessionIndex`, `chatActiveSessionId`, `chatActiveRuntimeBySessionId`, `chatSessionSubtitleById`. `runtime.ts`/`access.ts`/`threadMessages.ts`/`threadMetadata.ts`/`threadProviderSelection.ts`/`workspace.ts`/`threadHelpers.ts` (`createThreadMetadata` now takes `sessionId`) all conversation-scoped `agentId` → `sessionId`.
  - **appState tabs (M16-T3).** `openOrFocusAgentTab`/`closeTabsForAgent` → `openOrFocusSessionTab`/`closeTabsForSession`; `setLastActiveAgentId`/`getLastActiveAgentId` → `setLastActiveSessionId`/`getLastActiveSessionId`; `setAgentsSidebarCollapsed` → `setSessionsSidebarCollapsed`. `editorRouting.ts` `isAgentEditorPaneActive` → `isSessionEditorPaneActive`.
  - **Persistence (M16-T5) — `chatPersistenceCodec.ts`, `chatPersistence.ts`, `chatPersistencePaths.ts`.** On-disk envelope key `agents` → `sessions` (`CHAT_AGENTS_INDEX_VERSION` → `CHAT_SESSIONS_INDEX_VERSION`); `emptyAgentsIndexSnapshot` → `emptySessionsIndexSnapshot`; codec functions `decode/encode/upsert/removeAgentIndexEntry` → `…SessionIndexEntry…`; `decodeChatAgentThreadFileSnapshot`/`encode…` → `…Session…`; thread-metadata decode tolerates the legacy `agentId` key (half-migrated thread files still decode); path helpers `getWorkspaceAgentsDir`/`getWorkspaceAgentsIndexFilePath`/`getAgentThreadFilePath` → `getWorkspaceSessionsDir`/`getWorkspaceSessionsIndexFilePath`/`getSessionThreadFilePath`. `chatAgents.ts` → `chatSessions.ts` (`DRAFT_AGENT_TITLE` → `DRAFT_SESSION_TITLE`; `deriveAgent*`/`groupAgentsByLastUsedDate`/`filterAgentsByTitle`/`classifyAgentDateGroup`/`AgentDateGroup`/`AGENT_*` → `deriveSession*`/`…Session…`).
  - **Shell handlers/effects (M16-T4) — `appShellAgentHandlers.ts`, `appShellEffects.ts`, `appShellLayoutHandlers.ts`, `appShellHelpers.ts`, `appShellRuntime.ts`, `appShellPageHandlers.ts`, `appShellProjectTreeHandlers.ts`, `projectTreeController.ts`.** Handler exports `handleNewAgent`/`handleSelectAgent`/`handleDeleteAgent`/`handleRenameAgent`/`handleForkAgent`/`handleShareAgent`/… → `…Session` (factory `createAppShellAgentHandlers` kept); `restoreWorkspaceAgentSession` → `restoreWorkspaceSession`; `ensureChatHttpAgentTab` → `ensureChatHttpSessionTab`. Effects: `syncAgentTabEffect` → `syncSessionTabEffect`; `isAgentTabActive`/`selectedAgentId`/`sessionLastActiveAgentId` → `isSessionTabActive`/`selectedSessionId`/`sessionLastActiveSessionId`. Responsive-layout flags/constants `autoAgentsSidebarCollapsed`/`RESPONSIVE_*_AGENT` → `…Session…`.
  - **UI components (M16-T6).** `AgentsSidebar.svelte` → `SessionsSidebar.svelte`, `AgentSidebarRow.svelte` → `SessionSidebarRow.svelte`, `agents-sidebar.css` → `sessions-sidebar.css` (class prefix `agents-*` → `sessions-*`); `agentsSidebarController.ts` → `sessionsSidebarController.ts` (`createAgentsSidebarController` → `createSessionsSidebarController`). `AppShell.svelte` props `agentsSidebar` → `sessionsSidebar` (sub-props `agents`/`activeAgentId`/`onSelectAgent`/… → `sessions`/`activeSessionId`/`onSelectSession`/…); editor chrome session-action props `onDeleteAgent`/`onForkAgent`/`onShareAgent`/… → `…Session`. `ChatPanel.svelte`/`ChatComposer.svelte`/`TabBar.svelte` conversation-scoped identifiers → session. `+page.svelte` rewired (`workspaceAgents` → `workspaceSessions`, `selectedAgentId` → `selectedSessionId`, `agentNotificationObserver` → `sessionNotificationObserver`, etc.). `WorkspaceCatalogPicker.svelte` keeps **agent** (OpenCode persona picker — correct).
  - **Diagnostics/events (M16-T7) — `chatDiagnostics.ts`, `agentNotificationObserver.ts` → `sessionNotificationObserver.ts`, `chatSendPipeline.ts`.** `logChat*` diagnostic params `agentId` → `sessionId`; notification event id `"agentDone"` → `"sessionDone"` (persisted sound/OS settings key break — old `agentDone` toggles reset to default; acceptable pre-release); `SendChatMessageFailureReason` `"no_agent"` → `"no_session"`; `ChatTurnSuccessResult.agentId` → `sessionId`; `persistAgentThreadOnce`/`scheduleAgentThreadFilePersistence` → `…Session…`. Send-pipeline OpenCode-session locals renamed `sessionId` → `opencodeSessionId` to disambiguate from the conversation `sessionId` (no behavior change — backend methods still receive the OpenCode id under their `sessionId` param).
  - **Docs (M16-T8) — `docs/architecture.md`, `docs/opencode-integration.md`.** Architecture doc updated to session terminology (`TabState` session kind, session index, `editorRouting.ts` session tab); persistence row documents the `agents` → `sessions` envelope rename and the abandoned-`chat/{hash}/` re-open behavior. opencode-integration terminology section updated to reflect post-M16 internal naming.
  - **Validation — `npm test` 1799/1799; `npm run check` 0/0; `cargo test` 20/20.** M16 is complete.
  - **Scope discipline — no data migrations (per AGENTS.md).** Pre-M16 `chat/{hash}/` folders (old `agents` envelope / `agentId` thread metadata) are abandoned on first re-open; pre-M16 window snapshots with `"agent"`-kind tabs still load via the `normalizeTabState` legacy branch; pre-M16 sound/OS `agentDone` toggles reset to default. `WorkspaceAgentBackend`/`workspaceAgentBackend.ts`/`workspaceAgentHydration.ts` module names retained (SDK-bridge wrapper; rename deferred per R5).

## 2026-06-23 22:40

- **Phase 3.5 M14 — OpenCode sidecar tooling & port settings (completed).** Adds (a) a maintainer CLI for refreshing the bundled OpenCode sidecar binaries from upstream GitHub releases, and (b) a configurable sidecar port exposed in Settings (Option A: explicit `opencode.sidecarPort` instead of a hard-coded `4096` in Rust). Indexed in `execution-plan.md` as M14.
- **Maintainer script — `scripts/update-opencode-sidecar.sh`** — bash, `set -euo pipefail`. Args: `--version latest|vX.Y.Z`, `--platform current|all`, `--check-only`. Downloads `https://github.com/anomalyco/opencode/releases/download/<tag>/<asset>`, extracts the CLI from the `.zip` / `.tar.gz` archive (Mach-O / ELF / PE magic-byte check refuses HTML error pages), writes to `app/src-tauri/binaries/opencode-<triple>`, `chmod +x`, then prints the resolved `--version` so the maintainer can confirm before committing. Asset→triple mapping (current OpenCode release assets — **note**: the names in the M14 plan were aspirational; actual assets are zip/tarball archives containing the `opencode` binary, not bare binaries): `opencode-darwin-arm64.zip` → `aarch64-apple-darwin`, `opencode-darwin-x64.zip` → `x86_64-apple-darwin`, `opencode-linux-arm64.tar.gz` → `aarch64-unknown-linux-gnu`, `opencode-linux-x64.tar.gz` → `x86_64-unknown-linux-gnu`, `opencode-windows-x64.zip` → `x86_64-pc-windows-msvc.exe`. `--check-only` reports drift without writing and exits non-zero if any triple is stale. `--platform all` walks every supported triple for release prep.
- **npm alias — `app/package.json`** — `npm --prefix app run update-opencode-sidecar` (and `-- --version vX.Y.Z` / `-- --platform all --check-only`) wires the script through the existing npm workflow. `binaries/README.md` documents the script, the asset→triple table, and the manual fallback if upstream renames an asset.
- **Settings schema — `OpencodeSettings.sidecarPort: number`** — new field on `app/src/lib/domain/settings.ts`, default `4096` (`DEFAULT_OPENCODE_SIDECAR_PORT` in `opencodeSettings.ts`). `normalizeOpencodeSettings` validates the value on every load: missing / non-integer / NaN / out-of-range → `4096`; in-range integers (1024–65535) preserved. In sidecar mode `baseUrl` is derived from `buildOpencodeSidecarBaseUrl(port)` = `http://127.0.0.1:${port}` so the URL probe and SDK wiring stay consistent; in URL mode `baseUrl` is the user-supplied URL and `sidecarPort` is still carried for one-click mode switching. `validateOpencodeSidecarPort(port)` (UI gate, 1024–65535) and `isOpencodeSidecarPort(candidate)` (type guard) exported for the UI and tests.
- **Rust sidecar — `app/src-tauri/src/opencode_sidecar.rs`** — `opencode_sidecar_attach_workspace`, `opencode_sidecar_start`, and `opencode_sidecar_restart` now accept `port: Option<u16>`. When `Some(p)`, the inner state adopts the new port before any reuse/spawn decision (`apply_port_override`); when `None`, the existing port (default `4096`) is kept. A port change while a child is running forces `stop_child` + respawn via the existing `start_or_attach` / `start_or_attach_nonblocking` flow. `wait_for_health` now takes the actual port so the `HealthTimeout` error reports the right value instead of the hard-coded `4096`. New Rust unit tests: `apply_port_override_updates_inner_port`, `current_status_reports_configured_port`, `health_timeout_error_reports_actual_port` (15 → 18 opencode_sidecar tests, +3 net new).
- **TS bridge — `app/src/lib/services/opencodeSidecar.ts`** — invoke wrappers `attachOpencodeSidecarWorkspace`, `startOpencodeSidecar`, `restartOpencodeSidecar` now take `{ directory, port? }` and forward `port` only when defined (no spurious `port: undefined` reaching Rust). `OpencodeSidecarEnsureInput.port?: number` carries the same value into the central `ensureOpencodeSidecar` service so a settings-driven port change re-attaches on the new port.
- **Effects / backend wiring — `app/src/lib/services/appShellEffects.ts`, `app/src/lib/ai/backends/workspaceAgentBackend.ts`, `app/src/lib/ai/backends/opencodeBackendFactory.ts`, `app/src/lib/ai/chatSendPipeline.ts`** — `OpencodeRuntimeConfig` now includes `sidecarPort`; every resolve-runtime-config closure (`factory`, `chatSendPipeline.ensureWorkspaceAgentSessionId`) forwards `settings.opencode.sidecarPort` so the sidecar attach on Send uses the configured port. `requestOpencodeHealthRefresh` (Settings → Check connection) takes `opencodeSidecarPort` and passes it to `ensureOpencodeSidecar({ intent: "settings", port })` so the running sidecar restarts on the new port on the next explicit retry. The Send path (`executeWorkspaceAgentBackendTurn`) does the same with `intent: "send"`. `+page.svelte` derives `opencodeSidecarPort` from settings and feeds it into both the sidecar effect and the health-refresh effect. Removed `DEFAULT_OPENCODE_BASE_URL` (the legacy `http://127.0.0.1:4096` literal); the default is now `DEFAULT_OPENCODE_SIDECAR_PORT = 4096` and the baseUrl is `http://127.0.0.1:${DEFAULT_OPENCODE_SIDECAR_PORT}`.
- **Settings UI — `app/src/lib/components/settings/OpenCodeSettingsPanel.svelte`** — when `mode === "sidecar"`, the panel shows a numeric **Sidecar port** input (1024–65535, integer, default 4096) instead of the URL field. The URL mode branch is unchanged. Port edits validate with `validateOpencodeSidecarPort`; valid ports persist and trigger the same reconnect flow as mode / URL changes (`applyOpencodeReconnectState` clears the sidecar circuit breaker + sets `opencodeHealth.status = "checking"` + re-runs `runAccessPreflight`). A read-only hint below the input shows the effective sidecar URL (`http://127.0.0.1:<port>`) so users can see the URL the SDK will hit.
- **Tests** — `app/src/lib/services/opencodeSettings.test.ts` (+20 tests): defaults, legacy normalization, non-integer / NaN / out-of-range rejection, boundary 1024 / 65535, port-in-URL-mode independence, `validateOpencodeSidecarPort` (5 cases), `isOpencodeSidecarPort` (2 cases), `buildOpencodeSidecarBaseUrl`. `app/src/lib/services/opencodeSidecar.test.ts` (+3 tests): the new invoke wrappers forward `port` when provided. Updated mocks in `appShellEffects.opencodeSidecar.test.ts` (10 effect / refresh calls now include `opencodeSidecarPort`), `workspaceAgentBackend.test.ts` (16 `resolveRuntimeConfig` mocks include `sidecarPort`), `workspaceAgentBackendConfig.test.ts`, `workspaceAgentBackendWorkspaceUx.test.ts`, `phase3M3.validation.test.ts` (5 mocks), `workspaceAgentBackend.messages.test.ts`.
- **Docs — `docs/opencode-integration.md`, `app/src-tauri/binaries/README.md`, `README.md`** — added the sidecar-port setting step to the setup walkthrough, the binary-update script usage to the sidecar notes, and a one-liner to the README's Sidecar (default) paragraph. `binaries/README.md` documents the script, the asset→triple table, and the manual fallback if upstream renames an asset.
- **Validation** — `npm test` 1825 / 1825 (+19 net new vs M13.5 baseline of 1806); `npm run check` 0 / 0; `cargo test` 20 / 20 (+3 opencode_sidecar tests). M14 is complete.
- **Scope discipline** — no data migrations (per AGENTS.md); legacy settings without `sidecarPort` normalize to `4096`. URL mode semantics unchanged: the URL field still drives the probe in URL mode; `sidecarPort` is carried as a hidden field for one-click switch-to-sidecar. CI release workflow untouched — release CI still bundles whatever binaries are committed at tag time; the script is maintainer-only.

## 2026-06-23 21:30

- **CI build fixes (release workflow).**
  - `.github/workflows/release.yml` — removed the `uploadWorkflowArtifacts` input from `tauri-apps/tauri-action@v0.6.2` (not a valid input for v0.6.2; was producing an `Unexpected input(s)` warning every release run). Switched dependency install from `npm install` to `npm ci` so the workflow uses the locked versions in `app/package-lock.json` instead of letting npm silently update them (this was the root cause of the `vite v6.4.3` (vs locally-installed `6.4.2`) mismatch that made the SSR build parse TS-only syntax as plain JS).
  - `app/svelte.config.js` — enabled script preprocessing via `vitePreprocess({ script: true })`. Without `{ script: true }`, `vitePreprocess` only handles `<style lang="…">` blocks; `<script lang="ts">` content was emitted untouched, which Rollup then tried to parse as plain JS and failed at the first `?` (optional-parameter) annotation (`src/routes/+page.svelte:274` `title?: string`).
  - `app/package.json` — `build` script now runs `svelte-kit sync && vite build` so `.svelte-kit/tsconfig.json` is generated before Vite reads `tsconfig.json`. Removes the `Cannot find base config file "./.svelte-kit/tsconfig.json"` esbuild warning that appeared at the top of every `vite build` run on a fresh checkout.
  - **Verification:** `npm run build` completes with no esbuild / TS-parse warnings; `npm test` 1806/1806 pass.

## 2026-06-23 20:25

- **Phase 3.5 M13.5 — Lazy OpenCode sidecar & session-tab gating (completed).** Stops eager sidecar startup on workspace activation and non-session tabs. The sidecar is now spawned lazily by **Send** and explicit Settings actions only, with a single-flight `ensureOpencodeSidecar` service, an in-memory circuit breaker for hard failures, and a non-blocking Rust spawn. Closes the UI-lag-on-tab-switch / repeated-attach-on-port-in-use symptoms reported in development. Indexed in `execution-plan.md` as M13.5 between M13 and M14.
  - **Central ensure service — `app/src/lib/services/opencodeSidecarEnsure.ts`** — new single-flight + circuit-breaker API replacing eager `attachOpencodeSidecarWorkspace` calls. Intents: `"send"` (primary spawn), `"settings"` (Check connection / Refresh model list / config panels; clears breaker), `"background-sync"` (L3 reconcile + hydrate; never spawns; returns `null` when sidecar isn't running), `"status-only"` (probe only). Hard failures (`portInUse`, `missingBinary`, `launchFailure`, `healthTimeout`) trip the breaker; `"background-sync"` and `"status-only"` return `null` immediately when the breaker is active; `"settings"` and `"send"` may attempt and clear on success. Exports `isOpencodeSidecarBlocked`, `clearOpencodeSidecarCircuitBreaker`, `getOpencodeSidecarLastFailureSignature`, `resetOpencodeSidecarEnsureForTests`.
  - **Rust non-blocking spawn — `app/src-tauri/src/opencode_sidecar.rs`** — `start_or_attach_nonblocking` returns in <500 ms with `health: checking`; a dedicated `poll_health_in_background` thread resolves health on a 15 s cap and marks errors on timeout / process exit. `OpencodeSidecarState` is `Clone` via `Arc<Mutex<…>>` so the background poller shares the same managed state. `spawn_sidecar_blocking` kept for the (rare) synchronous restart path.
  - **Shell effect — `app/src/lib/services/appShellEffects.ts`** — `syncOpencodeSidecarEffect` no longer calls `attach` on workspace activation. Sidecar-mode path now probes `getOpencodeSidecarStatus` only when `isAgentTabActive` and the circuit breaker is clear; file/editor tabs skip sidecar-mode health work entirely. URL mode still probes but is also gated on `isAgentTabActive`. `requestOpencodeHealthRefresh` (Settings → Check connection) uses `ensureOpencodeSidecar({ intent: "settings" })` so it can spawn / restart the sidecar and clears the breaker on attempt.
  - **Backend factory — `app/src/lib/ai/backends/opencodeBackendFactory.ts`** — `createOpencodeBackendFromAppState({ ensureIntent })` accepts an intent (defaults to `"settings"` for backward compatibility). Background callers pass `"background-sync"`; the Send pipeline uses `"send"`. `createClientForWorkspace` now calls `ensureOpencodeSidecar` instead of `attachOpencodeSidecarWorkspace`, so background reconcile / hydrate / catalog prefetch never spawns.
  - **Session-tab gating** — `app/src/routes/+page.svelte`: `syncOpencodeSidecarEffect` receives `isAgentTabActive`; `refreshFileStatuses` effect now depends on `isAgentTabActive` and skips on file/editor tabs. `ChatPanel.svelte`: removed the catalog auto-refresh `$effect` (catalog stays empty until Settings refresh or first Send). `appShellAgentHandlers.ts`: `restoreWorkspaceAgentSession` now takes `skipOpencodeReconcile` (used by `syncAgentTabEffect` when not on a session tab) and replaces eager hydrate with `maybeBackgroundSyncWorkspaceSession` (fire-and-forget; L3 conditions gate it).
  - **L3 background sync** — `maybeBackgroundSyncWorkspaceSession` runs only when sidecar is healthy, active session has a linked `opencodeSessionId`, thread has ≥ 1 message, and last message role is `user`. Skips hydrate when last message is `assistant` (L3-A); local cache is sufficient after a completed turn.
  - **Send pipeline — `app/src/lib/ai/chatSendPipeline.ts`** — `executeWorkspaceAgentBackendTurn` calls `ensureOpencodeSidecar({ intent: "send", directory: root })` before the first OpenCode API call in sidecar mode; surfaces a typed `WorkspaceAgentBackendError` (`serverUnavailable`) when the breaker or a fresh spawn fails.
  - **Readiness checker — `app/src/lib/ai/providers/bootstrap.ts`** — `unknown` / `checking` no longer block the composer when the sidecar isn't started. Only `error` (and a `loading` / `error` catalog) blocks typing; sidecar may be spawned lazily on Send without the composer complaining.
  - **Hard-failure UX** — `+page.svelte`: deduped snackbar (`"OpenCode could not start. Check Settings → Workspaces → OpenCode."`) on each distinct failure signature; `lastHardFailureSignature` suppresses re-emits on tab switch while the breaker is active. `OpenCodeSettingsPanel.svelte`: toggling OpenCode enabled / mode / baseUrl clears the circuit breaker so the user can retry without a tab switch.
  - **Tests — `opencodeSidecarEnsure.test.ts` (10 new)** — single-flight, breaker-tripping, `background-sync` returning `null` after breaker is active, `settings` clearing the breaker, `status-only` and `background-sync` short-circuits, health-settle wait, hard-failure settle. **`appShellEffects.opencodeSidecar.test.ts` (rewritten)** — verifies `syncOpencodeSidecarEffect` never attaches on workspace activation, probes only on session-tab active, skips sidecar work on file-tab and URL-mode-on-file-tab, and that `requestOpencodeHealthRefresh` spawns via `ensure({ intent: "settings" })`. Updated mocks in `appShellAgentHandlers.test.ts`, `chatSendPipeline.test.ts`, `sendChatMessage.test.ts`, `phase3M3.validation.test.ts` for the new ensure path.
  - **Docs** — `docs/opencode-integration.md` gained a **Sidecar lifecycle — lazy, session-scoped** section (spawn table, non-session-tabs guarantee, L3 conditions, circuit breaker, non-blocking spawn); `README.md` Quick start + Sidecar mode paragraphs updated (sidecar starts on first Send / Settings check, not on folder open).
  - **Scope discipline** — no data migrations; legacy settings normalize to existing defaults; behavior change only. URL mode (probe external server) is unchanged and circuit breaker does not apply to repeated auto-probe (none runs on file tabs). M14 (`sidecarPort` setting) and M16 (rename `agentId` → `sessionId`) are independent of this milestone; the ensure API accepts port from settings when M14 lands.

## 2026-06-23 18:00

- **Added Phase 3.5 M13.5 execution plan — lazy OpenCode sidecar & session-tab gating.** Documents the agreed sidecar lifecycle refactor: no eager spawn on workspace/file tabs; start on **Send** and explicit Settings actions; circuit breaker after hard failures with deduped snackbar; background reconcile/hydrate only when sidecar is already healthy, session is linked, thread has messages, and last message is from the user (skip hydrate when last message is assistant); non-blocking Rust spawn; central `ensureOpencodeSidecar` with single-flight. Indexed in `execution-plan.md` as M13.5 between M13 and M14.

## 2026-06-23 16:57

- **Added per-message date-time label.** A small `HH:MM` (or `MM/DD HH:MM`, with year for prior years) timestamp now renders at the bottom-right corner of every message bubble — including user, assistant, system, and provider/model-switch events — so the transcript is easier to scan.
  - **Render** — `<time class="chat-message-timestamp">` element inside each `.chat-message` `<li>`; bubble made `position: relative`; absolutely positioned at `right/bottom` of the bubble.
  - **Format** — `formatMessageTimestamp()` in `ChatMessageList.svelte` (same-day → `HH:MM`; older same-year → `MM/DD HH:MM`; prior year → `YYYY/MM/DD HH:MM`); `24-hour`, `tabular-nums`. `title`/`datetime` carry the raw ISO value for hover tooltip and a11y.
  - **Collision** — `.chat-message-totals` gains right-padding so the token/cost footer never overlaps the new label.
  - **Hide on empty** — `:empty` pseudo hides the label when `createdAt` is missing/invalid (legacy transcripts).
  - **Verification:** `npm run check` 0/0.

## 2026-06-23 15:30

- **Phase 3.5 M15 — OpenCode session terminology (user-facing, completed).** Aligns workspace UX with OpenCode Desktop: **Session** = conversation (sidebar, tab, transcript, lifecycle); **Agent** = persona only (Settings → Agents, composer picker, `@agent:`). Copy-only — no internal renames (`agentId`, `AgentsSidebar`, disk paths deferred to M16).
  - **Sidebar & tabs** — workspace sidebar title **Sessions**; **All sessions…** browser button; draft title **New session**; tab tooltip **Session**; chat panel aria **Session chat**, delete **session**, fallback title **Session**.
  - **Composer & handlers** — **Message session** placeholder; session lifecycle toasts/prompts (rename, fork, share, open external); fork tooltip **new session tab**.
  - **Settings & blocked copy** — OpenCode toggle **Use OpenCode for workspace sessions**; MCP blurb **workspace sessions**; `chatErrorCopy` recovery lines; access ready message; model catalog hint.
  - **Notifications** — OS copy **Session finished** / **Session error**; Appearance event label updated.
  - **Docs** — `docs/opencode-integration.md` **User-facing terminology** section; setup steps use session vocabulary.
  - **Plans** — added `execution-plan-m15.md` (complete) and `execution-plan-m16.md` (internal rename, planned); indexed in `execution-plan.md`.
  - **Tests** — `chatAgents.test.ts`, `chatPersistence.test.ts`, `chatM5-2.validation.test.ts` assertions for **New session**.

## 2026-06-23 13:15

- **Phase 3.5 M13 — HTTP Chat beta gate & Dev settings (completed).** Treats the experimental `chat-http` lane as opt-in: the Chat rail and the Settings → Chats subtree are hidden by default; the Dev settings section becomes the entry point for the Chat (beta) master toggle and for nested Chats tabs (Providers, Chat modes, Debug Provider) once enabled. Logs are also relocated under Dev. Persisted provider config, API keys, and thread data remain on disk; only UI and rail access are gated.
  - **Domain + persistence** — added `ChatHttpSettings { enabled: boolean }` (default `false`) to `AppSettingsState` and `PersistedSettings`. New service `chatHttpSettings.ts` exports `defaultChatHttpSettings`, `normalizeChatHttpSettings`, and `isChatHttpEnabled`. Legacy settings.json files normalize to `enabled=false`; non-boolean values are coerced. `setChatHttpEnabled` slice action + `applyPersistedSettings({ chatHttp })` patch + `toPersistedSettings` round-trip. Persistence wired in `appShellEffects.syncSettingsPersistenceEffect` and `appShellRuntime` startup.
  - **Rail + runtime gate** — `isChatHttpRailVisible(settings, apiKeys, debugChat, chatHttp)` now short-circuits to `false` when `chatHttp.enabled` is off, before any provider/config checks. `canRestoreChatHttpAsActive` (used in `applyWindowSession` and `switchContext`) now respects the master toggle, so restoring a chat-http window session with the beta off falls back to Notepad. ActivityRail tooltip / aria-label now read "Chat (beta)".
  - **Dev sidebar** — new `dev` tab and `DevSettingsPanel.svelte` (master toggle + short explanation when off, hint list when on). `settingsDialogUi.buildSettingsSidebar(chatHttp)` is now the source of truth for sidebar entries: top-level **Editor / Shortcuts / Appearance**; **Dev** always has the master toggle and **Logs**; the **Chats** subtree (Providers, Chat modes, Debug Provider) appears only when `chatHttp.enabled` is true. **Logging** standalone section removed. Settings dialog `activeTab` auto-resets to **dev** if the user toggles the beta off while a gated tab is selected. Hidden tabs are unreachable from sidebar, measure, and panel switcher (filter at sidebar builder rather than only live visibility).
  - **Deep links** — `openSettingsDialog(tab)` now resolves the requested tab against the chat-http beta gate (`resolveOpenSettingsDialogTab`): gated tabs (`connections`, `chatModes`, `debugAi`) redirect to `dev` when the beta is off; otherwise they pass through. `ChatBlockedState` gained `isChatHttpFeatureBlocked` which renders a "Chat (beta) is off" panel with a CTA to **Open Settings → Dev**. All chat-http user-facing copy in `chatErrorCopy.ts`, `openAiCompatibleChatProvider.ts`, and the M5-3/M6-5/phase-2/retry tests was retargeted from `Settings → Chats → …` to `Settings → Dev → … (Chat beta)`.
  - **Docs** — moved `docs/providers.md` → `docs/beta/chat-http-providers.md`; added `docs/beta/README.md` index. README trimmed: workspace agents / OpenCode are now the headline AI story; the experimental HTTP Chat context is documented as opt-in beta with a one-line pointer to `docs/beta/`. `docs/architecture.md` updated to reflect the new sidebar layout and `buildSettingsSidebar` builder. `docs/opencode-integration.md` left as the stable-path doc, unchanged.
  - **Validation** — `npm test` 1795 / 1795; `npm run check` 0 / 0; `cargo test` 17 / 17. New unit tests in `chatHttpSettings.test.ts`, `chatHttpRailGating.test.ts` (added master-toggle assertions + kept existing config cases gated on `chatHttp.enabled=true`), `settingsStore.test.ts` (5 new chatHttp cases), and `settingsDialogUi.test.ts` (sidebar builder, gate resolver, `openSettingsDialog` redirect). Phase-3 M3 regression gate test updated to opt-in chatHttp in `beforeEach`; workspace-agent tests untouched.
  - **Scope discipline** — no data migrations, no compatibility shims; legacy installs with HTTP configured must re-enable in **Settings → Dev**. Workspace agents (`opencode.enabled`, agent UI, OpenCode settings) and the workspace Debug Provider (`debugAgent`) are unchanged. **Appearance → Chat font scale** intentionally stays in **Appearance** (it affects workspace agent transcripts too).

## 2026-06-23 14:00

- Added `specs/ops/phase-3.5/execution-plan-m14.md` — milestone plan for OpenCode sidecar maintainer tooling (manual `scripts/update-opencode-sidecar.sh` to refresh Tauri `externalBin` binaries from GitHub releases) and configurable sidecar port via persisted `opencode.sidecarPort` (Option A: explicit field, default 4096, synced `baseUrl` in sidecar mode).
- Indexed M14 in `specs/ops/phase-3.5/execution-plan.md` under a new Post-M12 product & tooling subsection alongside M13.

## 2026-06-23 12:30

- **Fix: OpenCode sidecar health check could hang forever on "Checking (sidecar)".** `opencode_sidecar_status` invoked a blocking `ureq` HTTP probe against `http://127.0.0.1:4096/global/health` with no timeout; if another process held the port and accepted the TCP connection but never responded (or the port listener was orphaned), the probe blocked indefinitely, the Tauri `invoke` promise never resolved, and the Settings → OpenCode panel stayed on "Checking (sidecar)" forever.
- Rust: added `HEALTH_PROBE_TIMEOUT = 7s` and a new `build_probe_agent()` helper using `ureq::AgentBuilder::new().timeout(...).build()`; both `probe_health` and `probe_health_detailed` (used by `opencode_sidecar_status`, `start_or_attach`, and `spawn_sidecar`'s `wait_for_health`) now share this bounded agent.
- JS: added `SIDECAR_STATUS_TIMEOUT_MS = 7_000` next to the existing `URL_HEALTH_TIMEOUT_MS` in `appShellEffects.ts`; the sidecar branch of `requestOpencodeHealthRefresh` now races `getOpencodeSidecarStatus()` against a `setTimeout` reject, surfacing a clear error in the OpenCode settings pill (matching the URL-mode timeout pattern) instead of leaving the UI stuck on "Checking (sidecar)".

## 2026-06-23 11:36

- Added `docs/opencode-integration.md` with OpenCode architecture flow, workspace/agent/session relationship model, integrated feature coverage, and step-by-step setup for sidecar/URL modes in SpecOps.
- Updated `docs/providers.md` to link the dedicated OpenCode integration/setup guide from the workspace-context note.
- Added user-facing OpenCode tooltips in `OpenCodeSettingsPanel.svelte`, `ChatPanel.svelte`, and `TitleBar.svelte` for settings toggles/radios, session menu actions, and the title-bar status button.
- Scope is tooltip text only (`title` attributes); no behavior or interaction logic changed.

## 2026-06-23 10:15

- **Fix: blank white-screen on app launch (Tauri webview).** `npm run tauri dev` (and any other path that loads the SvelteKit dev server) was opening an empty white webview because `@opencode-ai/sdk/v2`'s barrel re-export pulled `cross-spawn` → `which` → `process` into the browser bundle, throwing `ReferenceError: process is not defined` from the very first `import(".../app.js")` in SvelteKit's client entry. With the app failing to mount, SvelteKit never got a chance to render anything.
  - **Root cause.** `@opencode-ai/sdk/v2`'s `dist/v2/index.js` is a barrel: it re-exports `./server.js` (the sidecar spawner) alongside `./client.js`. `server.js` does `import launch from "cross-spawn"` at the top level, and `cross-spawn` → `which` references `process.env.PATH` and `process.platform` at the module top level. Vite pre-bundles the whole barrel for the browser (it has no way to know which named export the app uses), so even though `workspaceAgentBackend.ts` only imports `createOpencodeClient` + `OpencodeClient`, the Node-only chain is evaluated on first import in the webview → `process is not defined` → module load rejects → SvelteKit's `Promise.all([import(entry), import(app)])` rejects → nothing mounts.
  - **Fix.** Deep-import from `@opencode-ai/sdk/v2/client` (one of the SDK's own subpath exports in its `package.json`) instead of `@opencode-ai/sdk/v2`. `v2/client.js` exports `createOpencodeClient`, `OpencodeClient`, and `OpencodeClientConfig` with no Node-only side effects — no `server.js`, no `cross-spawn`, no `process`. Single-line change in `workspaceAgentBackend.ts:5-8`; no call-site edits (the imported symbols are unchanged).
  - **Verification.** Headless-Chrome dev-server load → no `process is not defined`, full AppShell mounts (189 KB rendered DOM, `tab-strip` / `status-bar` / `cm-editor` / `SpecOps` title present); `npm run build` succeeds (`✓ built in 4.07s`, `✔ done`); `npm run check` → 0 errors / 0 warnings.

## 2026-06-20 01:05

- **`Select` drop-down restyle — ported Unity-AI-Hub's look onto the existing component.** Brought the signature drop-down button styling from the Unity-AI-Hub Tauri app (`/Users/alexeyperov/Projects/Unity-AI-Hub/hub/src/lib/components/shell/Select.svelte`) into spec-ops's own `Select.svelte`. CSS-only change to a single file; the script (runes, keyboard nav, outside-click/Escape dismissal), markup, props, and `SelectOption` type are untouched, so all 8 existing `<Select>` usages (composer pickers + settings panels) inherit the new look with zero call-site edits.
  - **Trigger hover → accent border.** Replaced the previous background-tint hover (`background: var(--color-hover)`) with Hub's accent-border hover (`border-color: var(--color-accent)`), and added the accent border to the `:active` state too so press stays coherent. Added `font-weight: 500` to the base trigger (Hub uses medium weight).
  - **Selected option → accent color + bold.** Hub's signature trait: the currently-selected listbox option now renders in `var(--color-accent)` + `font-weight: 600`, instead of just bold.
  - **Listbox border bumped** from `--color-border-subtle` to `--color-border-strong` so the open panel reads with slightly more definition against the trigger (matching Hub's stronger panel vs. trigger border).
  - **Deliberate adaptations** (not blind copies): kept spec-ops's **content-width** trigger (Hub uses `width: 100%`, which would break the compact composer pickers) and **primary default text** on the trigger (Hub uses dim text; spec-ops shows the current value in toolbars/forms). No `--hub-*` token namespace introduced — everything is mapped onto spec-ops's existing `--color-*` / `--space-*` / `--radius-*` tokens, so it respects spec-ops theming (light/dark, custom accent color).
  - **Verification:** `npm run check` → **0 errors / 0 warnings** (unchanged from the M12-T3 baseline).

## 2026-06-20 00:30

- **Phase 3.5 M12-T4 — `formatCost` ambiguity re-affirmed.** Closed the fourth and final `[P2]` review observation. `formatCost` (`chatTokenFormat.ts:36-41`) renders a genuine zero cost (free / fully-cached model) and a *missing* cost identically as `"$0.00"`; M11-T3 had accepted this because the surrounding guards already let the session-level path distinguish "no data" from "zero cost". Took the **recommended (re-affirm) approach** rather than the sentinel alternative: verified the documented guard invariant holds end-to-end, then pinned it with a test.
  - **Invariant verified at all four consumers:**
    - **Per-message footer** (`ChatMessageList.svelte:480`): `{#if stepTotals}` where `stepTotalsFor(message)` returns `null` for non-assistant messages or when `extractMessageStepTotals` is null — so a missing-cost message renders *no footer*, never a `$0.00` one.
    - **Session-level badge** (`ChatPanel.svelte:398`): `{#if sessionTotals}` where `sessionTotals` is `extractSessionTotals(messages)`; `messageCount: 0` → `null` → no badge.
    - **Per-step separator** (`StepSeparator.svelte:43`): `{#if boundary.cost !== undefined}` — only finish-phase steps carrying a cost field render a cost line; running steps / failed steps-without-cost show no cost.
    - **The extractors** (`extractMessageStepTotals` / `extractSessionTotals` in `ai/chatSteps.ts`): return `null` when no part contributes (no step finishes, no canonical cost part with a payload; a `cost` part with `cost === 0 && tokens === undefined` is treated as empty → null).
  - **Outcome:** the ambiguity is resolved everywhere it matters — a missing cost renders nothing (the null guard), while a genuine zero-cost message that still carried a token payload (free / fully-cached model) renders a footer showing `$0.00`. Threading a null/"unknown" sentinel through the four consumers was indeed disproportionate for a polish item, as M11-T3 judged; the documented acceptance stands.
  - **Tests:** +3 in `ai/chatSteps.test.ts` pinning the invariant — (1) a message whose parts carry only text/reasoning (no cost data) yields `null` (renders no footer); (2) a genuine zero-cost message (`cost: 0` with a real token payload) yields non-null totals whose `formatCost` renders `"$0.00"` — the distinct "genuine zero" path; (3) a canonical cost part with neither cost nor tokens (`cost: 0, tokens: undefined`) yields `null` (renders nothing, not a misleading `$0.00`). Decision recorded per the task's "either way, record the outcome" requirement.

## 2026-06-19 23:58

- **Phase 3.5 M12-T3 — `svelte-check` warnings 185 → 0.** Closed the third `[P2]` review observation. `npm run check` reported 0 errors / 185 warnings; both warning classes are now eliminated.
  - **T3a — genuine a11y / reactivity warnings (16 → 0), fixed:**
    - **Dialog `tabindex` (×5):** `SessionTimelineDialog`, `SessionListPanel`, `RevertPreviewDialog`, `AgentEditorDialog`, `ChatModeEditorDialog` — each `role="dialog"` element lacked a `tabindex`. Added `tabindex="-1"` (the standard pattern for programmatic-focus dialogs; these already drive focus to an inner input).
    - **Click-without-keyboard + `<img>` listeners (×3 + ×1):** `ImageAttachment`'s zoom overlay had `onclick={stopPropagation}` on the `<img>` (tripled with the "non-interactive `<img>` has listeners" warning). Replaced with an overlay-level `handleOverlayClick` that closes only when `event.target === event.currentTarget` (backdrop click), so the image stops needing any listener. `SessionListPanel` / `SessionTimelineDialog` dialog `<div>`s had redundant `onclick`/`onpointerdown` stopPropagation — removed (the backdrop already closes via a `target === backdropEl` check, so the child stopPropagation was dead defence).
    - **`<button> cannot have role 'listitem'` (×1):** `ChatModesSettingsPanel` mode tiles were `<button role="listitem">` inside a `role="list"`. A button can't be a listitem — removed both roles (a grid of labelled buttons is an implicit group).
    - **`<form> cannot have interactive role 'dialog'` (×1):** `EntryNamePrompt` was a `<form role="dialog">` (form is non-interactive). Split: the box/dialog role moved to a wrapper `<div role="dialog" tabindex="-1">`, the `<form>` (with its `onsubmit` Enter handling) now lives inside it. CSS split to match — `.entry-name-prompt` keeps the box; `.entry-name-prompt form` takes the `display: grid; gap` so title/input/actions spacing is preserved. Also dropped the form's redundant stopPropagation handlers (backdrop target-check handles it).
    - **`state_referenced_locally` (×5):** `StatusPopover` / `TodoPanel` / `DiffViewerPanel` called a store factory (`getStatusSummary` / `getSessionTodos` / `getSessionDiffs`) in the component body capturing the props' *initial* values. Moved the factory call into a `$derived(get…(props))` and subscribed in a second `$derived($store)`, so the store now re-derives when `workspaceRootPath` / `sessionId` change. (Note: `$derived($fn(args))` doesn't work — the `$` prefix only auto-subscribes bare identifiers, not function-call expressions — hence the two-step derive.)
  - **T3b — "unused CSS selector" false positives (169 → 0):** 15 settings panels each `@import`'d the shared stylesheets (`settingsForm.css` / `settingsFormMultiline.css` / `settingsDialogForm.css` / `settingsPanelLists.css`) inside their `<style>` blocks; svelte-check's per-component CSS analyzer can't trace selector→element across an `@import` boundary, so every `.settings-*` / `.connection-row-*` / `.required-section-*` selector was flagged as unused even though the classes are applied in the markup and render correctly at runtime. Took the **recommended fix**: imported the 4 shared stylesheets + `settingsFoldout.css` once globally in `src/routes/+layout.svelte` (alongside the existing `tokens.css` / `chatProse.css` / `settingsDialogChrome.css` global imports), and removed every per-component `@import` (the entire `<style>` block in 6 import-only panels; just the `@import` lines in 12 panels that also have their own custom CSS). The shared files are intentionally flat-global-class-based (no `:global()` wrappers needed; they target `.settings-*` etc. directly), so moving them global loses no per-component scoping — and stops the same CSS being re-emitted into 15 component bundles.
  - **No behaviour change** beyond the above (dialog roles/keydown/focus all preserved; `EntryNamePrompt` layout preserved; stores re-derive on the same props they always did). The pre-existing `vite build` `spawnSync` error (an `@opencode-ai/sdk` browser-external conflict in `node_modules`) is unrelated and present on clean master.
  - **Verification:** `npm run check` → **0 errors / 0 warnings** (was 0/185). `npm test` → **1767 passed**. `cargo test` → **17 passed**. Decision recorded per the task's "record the outcome" requirement.

## 2026-06-19 23:18

- **Phase 3.5 M12-T2 — Tolerant `parseParts` aggregation:** Closed the second `[P2]` review observation. `chatPersistenceCodec.parseParts` (`chatPersistenceCodec.ts:373-389`) previously returned `undefined` for *all* of a message's parts when *any* single entry failed `parseMessagePart` — so one malformed persisted part (e.g. a future part type unknown to the codec) stripped the entire structure (reasoning/steps/attachments) from an otherwise-valid message on load.
  - **Fix:** the loop now `continue`s on a `null` part and keeps the valid ones, matching the wire-boundary lenience already used in `mapPartsAndIndex` (`opencodeSessionMessages.ts`, which drops unknown part types one-by-one). The per-part `parseMessagePart` validators are unchanged (they still return `null` for a bad part) — only the aggregation policy changed.
  - **Degradation contract preserved:** `parseParts` still returns `undefined` when (1) the value is not an array (truly-malformed), or (2) the array is non-empty but *every* entry failed to parse. The second guard keeps the "no parts → undefined" contract downstream code relies on, so a fully-corrupt array degrades the message rather than producing a parts-less-but-present message that pretends to have structure. An empty input array still returns `[]` (a message that legitimately persisted with zero parts round-trips as zero parts).
  - **Consistency with AGENTS.md:** no persisted shape changes — this is a more lenient read of existing data, not a migration. A single unknown part type no longer takes down its siblings.
  - **Tests:** +3 in `services/chatPersistence.test.ts` — (1) one malformed part among valid ones is dropped and the valid ones survive in order; (2) every entry malformed still returns `undefined` (full degrade); (3) a non-array parts value still returns `undefined`. The pre-existing "drops malformed parts but preserves the message" test (single bad part = full degrade) continues to pin the second guard. All **1676 TS tests pass** (was 1673 — +3 net new; 18 pre-existing environment-related failures unchanged vs. master baseline: DOMPurify jsdom + Tauri `mkdir` mocks). svelte-check baseline unchanged (T3 owns those). Decision recorded per the task's "either way, record the decision" requirement.

## 2026-06-19 22:49

- **Phase 3.5 M12-T1 — Interleaved part-rendering order in `ChatMessageList`:** Closed the first `[P2]` review observation. `ChatMessageList.svelte` previously rendered parts by *type-block* (steps → reasoning → subtasks → content → tool cards → images → files → diffs) via per-type extractors (`reasoningFor`/`subtasksFor`/`stepsFor`/`attachmentsFor`/`diffsFor`), flattening any interleaving in the underlying `message.parts[]`. Took the **recommended approach** (interleave) rather than the accept-and-document fallback: parts now render at their stored positions in `parts[]`, so two text segments around a reasoning block render in that order.
  - **New layout helper (`ai/chatMessageLayout.ts`):** `buildMessageRenderSlots(message)` walks `message.parts` once and returns an ordered array of typed render slots (`text` / `reasoning` / `subtask` / `step-boundary` / `file-image` / `file-other` / `diff`). Validation mirrors the per-type extractors so the same malformed parts are dropped (whitespace-only reasoning, empty-agent subtasks, file parts with empty url/mime, diff parts with neither snapshot nor files); `cost` parts carry no UI (they feed `extractMessageStepTotals`) and are skipped. Step `start`/`finish` pairs collapse into a single `step-boundary` slot anchored at the **finish** part's position (where the step completes and the next content chunk begins); an open `start` with no finish anchors its running boundary at the start position. Step boundaries are positioned by arrival — NOT sorted by step number — so interleaving keeps position fidelity; `extractMessageSteps` (used for the totals footer) still sorts by number, and the two views are independent. Keeping this logic in a pure `.ts` module (not inline in the component) makes the layout unit-testable.
  - **Component rewrite (`components/ChatMessageList.svelte`):** replaced the 5 per-type extractors + fixed-block template with a single `slotsFor(message)` derived from `buildMessageRenderSlots`. The message body is now a single flex column (`.chat-message-body`) that iterates slots in order, dispatching each to its existing renderer (`ReasoningBlock` / `SubtaskCard` / `StepSeparator` / `MarkdownRenderer` / `ImageAttachment` / `FileAttachmentChip` / `InlineDiff`). Tool cards (`message.toolCalls`) and the totals footer (`extractMessageStepTotals`) stay outside the slot loop — they are not parts. The previous per-block CSS wrapper rules (`.chat-step-separators` / `.chat-subtask-cards` / `.chat-inline-diffs` / adjacency `margin-top` collapse rules) were removed in favour of a single uniform `gap` on the body column.
  - **Reasoning expand/collapse:** now per-reasoning-part (keyed by each part's id) rather than per-message (the old `extractMessageReasoning` joined all reasoning parts into one `|`-id'd block). The "show all reasoning" toolbar + `hasAnyReasoning` derived flag now key off the slots, so it still appears whenever any message carries a reasoning slot. Subtask/diff toggle state stays keyed by id (unchanged).
  - **Content rendering paths preserved:** (1) **text slots** — each renders via the same markdown-vs-plain decision the whole-message path used (`shouldRenderTextSlotAsMarkdown`), so interleaved text segments each get markdown treatment once streaming ends; (2) **no-text-slots fallback** — when `parts[]` has no text (the live-streaming case, where text lives on `message.content` via `updateMessageContent`, or flat content-only messages) `message.content` renders as a single block, preserving the streaming cursor / "Generating…" placeholder; (3) **structured-review sections** — a whole-message override that parses `message.content` as one document; rendered in place of the *first* text slot (so non-text parts keep their positions around it) when text slots exist, or via the content fallback when they don't. User/system messages still render `message.content` only (they reach this component with content-only, no `parts`).
  - **Tests:** +16 in new `ai/chatMessageLayout.test.ts` (slot ordering incl. the headline `text/reasoning/text` interleave, per-kind validation mirroring the extractors, step-boundary anchoring at finish / open-start, multi-step arrival ordering, image/file classification, diff/file drop rules, cost skip) and +9 in new `components/ChatMessageList.test.ts` (component-level: interleaved DOM order for text/reasoning/subtask/step/image/diff, streaming `message.content` fallback, no-parts flat content, tool cards after slots, totals footer outside body, per-reasoning-part collapse). All **1764 TS tests pass** (was 1739 — +25 net new). svelte-check **0 errors** (185 warnings, same baseline; T3 owns those). cargo test **17 passed**. Decision recorded per the task's "either way, record the decision" requirement.

## 2026-06-19 19:20

- **Phase 3.5 M12 plan — Post-completion polish (review observations):** Authored the optional post-completion milestone from the second-pass architecture & code-quality review's "observations worth noting (non-blocking)" section. Phase 3.5 was already formally closed by M11; this is a `[P2]` quality-of-life follow-up — **no code changed, docs only.** See [execution-plan-m12.md](./ops/phase-3.5/execution-plan-m12.md). Index updated in [execution-plan.md](./ops/phase-3.5/execution-plan.md).
- **Findings → tasks:**
  - **M12-T1 — Part-rendering order policy** (`[P2]`): `ChatMessageList.svelte:346-486` renders parts by *type-block* (steps → reasoning → subtasks → content → images → files → diffs) via per-type extractors (`reasoningFor`/`subtasksFor`/`stepsFor`/`attachmentsFor`/`diffsFor` at `:348-353`), flattening any interleaving in the underlying `message.parts[]`. Acceptable for current OpenCode wire shapes (one text block per assistant message) but a latent limitation. Task: either iterate `parts[]` in stored order through the existing renderers, or accept-and-document the type-block policy with a pinning test.
  - **M12-T2 — `parseParts` lenience** (`[P2]`): `chatPersistenceCodec.ts:373-389` returns `undefined` for *all* parts when *one* part is malformed — a single bad persisted part strips structure (reasoning/steps/attachments) from an otherwise-valid message on load. Task: skip a `null` part and keep the valid ones; only return `undefined` for a non-array or a fully-malformed array (matches the wire-boundary tolerance in `opencodeSessionMessages`).
  - **M12-T3 — `svelte-check` warning reduction** (`[P2]`): the 185-warning baseline is 169 "Unused CSS selector" false positives (15 settings panels `@import` shared stylesheets like `settingsForm.css` into their `<style>` blocks; svelte-check can't trace selector→element across `@import`) + ~14 genuine a11y/reactivity warnings in real phase-3.5 components (dialog `tabindex` ×5, click-without-keyboard ×3, `state_referenced_locally` ×5 in `StatusPopover`/`TodoPanel`/`DiffViewerPanel`, `<button role=listitem>` ×1). T3a fixes the genuine a11y/reactivity ones; T3b either moves the shared CSS to a single global import (eliminates the false positives + stops 15× CSS re-emission) or documents the 169 as an accepted baseline. Target ≤ 30 warnings.
  - **M12-T4 — `formatCost` ambiguity** (`[P2]`): a genuine zero cost and a missing cost both render `$0.00` (`chatTokenFormat.ts:36-41`); M11-T3 accepted this because the surrounding guards (`extractMessageStepTotals`/`extractSessionTotals` return `null` → no footer) already let the session-level path distinguish "no data". Task: verify that invariant holds end-to-end for the per-message/per-step footers (so a missing-cost message renders *no* footer, not a `$0.00` one) and pin it with a test; only thread a null sentinel if the check finds a real gap.
- **Scope note:** M12 is optional and independent — phase 3.5's status (complete) is unaffected. Each task carries a "decide, then implement" shape where "document and accept" is a valid outcome; record the decision in this changelog regardless.

## 2026-06-19 17:56

- **Phase 3.5 M11 — Polish & spec housekeeping:** Closed the final `[P1]`/`[P2]` polish + spec-housekeeping milestone from the phase-3.5 review. All four M11 tasks landed (T1–T4); see [execution-plan-m11.md](./ops/phase-3.5/execution-plan-m11.md). **This formally closes phase 3.5** — `phase-3.5.md` exit-criteria checklist ticked, `Status` flipped to complete.
- **Spacing scale (M11-T1):** The M6-T1 `--space-*` additions were non-monotonic with duplicate values (`--space-1 === --space-2 === 2px`; `--space-3 === --space-6 === 6px`; `--space-3` (6px) > `--space-4` (4px); `--space-10` (20px) > `--space-12` (12px)) — the numeric suffix didn't imply order. Collapsed to a monotonic, duplicate-free scale in `app/src/lib/styles/tokens.css`: `--space-1..12` = 2, 4, 6, 8, 10, 12, 16, 20, 24px. Audited every consumer; most use the tokens for small gaps where the exact px isn't visually critical. The structurally load-bearing ones were fixed to literal px so the geometry stays stable: `TabBar.svelte` derives tab height from `--tab-header-height - var(--space-8)` (the 8→16px bump would have shrunk tabs from 24→16px), so the tab height calc + horizontal padding now use literal `8px`/`6px`. Negative-margin/gap pairs (`ChatMessageList` reasoning toolbar), tree-indent bases, and dialog viewport margins were left on the tokens because they move coherently or absorb the bump harmlessly. Extended `app/src/lib/styles/structuralTokens.test.ts` with the ordering invariant: each step strictly greater than the previous, no duplicate px values, and the exact expected px per token pinned.
- **compaction / cost part render path (M11-T2):** Decision recorded. `cost` parts are produced by the hydration mapper and consumed by `extractMessageStepTotals` → the per-message footer / `SessionTotalBadge` / `StepSeparator` / session totals — confirmed no renderer draws them directly (they're data for footers). `compaction` parts had **no UI consumer at all** (produced by the mapper + validated by the codec, read by nobody). Pruned rather than wired a new renderer: SpecOps already renders its own FIFO compaction banner via `chatRetention.ts` / `ChatMessageList`'s `compactionNotice` prop, which is a different concept from OpenCode's per-message compaction marker, so the part type was dead surface area. Removed `ChatCompactionPart` from `domain/chat.ts` + `domain/contracts.ts`, the `case "compaction"` from `chatPersistenceCodec.ts` (the `default → null` now drops any legacy-persisted compaction part on parse — acceptable pre-release per AGENTS.md no-migrations rule), and `mapCompactionPart` from `opencodeSessionMessages.ts` (the `case "compaction"` now returns `null` with a docstring pointing at this decision). Updated the two affected tests (`opencodeSessionMessages.test.ts` now asserts compaction parts are dropped; `chatPersistence.test.ts` round-trip no longer includes a compaction part).
- **Minor correctness & consistency (M11-T3):** Five independently-safe fixes:
  - `summarizeSession` (`workspaceAgentBackend.ts`): extracted the `raw === true || raw === "true"` stringly-boolean into a documented `coerceSummarizeOk(raw)` helper so a future `{ ok: true }` object response reports failure explicitly rather than silently passing through. Added 2 tests (legacy `"true"` string accepted; object payload → `false`).
  - `mapAgentEntry` (`opencodeSearch.ts`): `MentionAgentEntry.isSubagent?` was advertised but never set, and the catalog `OpencodeAgentEntry` (id+name only) carries no `mode` to populate it from — removed the dead field.
  - `opencodeSearch.ts` header comment: "File search is debounced" was misleading (the `setTimeout` debounce lives at the call site in `ChatComposer.svelte`, not in the module) — corrected to state the module is un-debounced by design (so unit tests drive it synchronously) and callers debounce at the call site.
  - `composerPromptQueue.ts` / `promptHistory.ts`: picked immutable reassign as the single mutation style. `takeNextDeliverable`/`takeNextSteer` now `items = items.filter((_, i) => i !== idx)` instead of `items.splice`; `promptHistory.record` now builds a fresh array via `.map` instead of mutating `existing.count += 1` in place, and `.sort` runs on a `.slice()` copy. Both are now safe to lift into a Svelte `$state` proxy later.
  - `formatCost` (`chatTokenFormat.ts`): zero-cost vs missing-cost both render `$0.00` — **accepted and documented** (threading an "unknown" sentinel through 4 consumers + the totals extraction was disproportionate for a polish item). Added a doc note explaining callers that must distinguish use the `null`-totals / `messageCount` guards.
- **Phase 3.5 spec housekeeping (M11-T4):** `phase-3.5.md` exit-criteria checklist ticked (`[ ]` → `[x]`, with M7–M10 follow-ups noted against the items they close: M8 → M1 live-stream, M7-T2 → M5 diff-store correctness); `Status: draft` → `Status: complete`; added a `phase-3.5.md` changelog row. `execution-plan.md` index already lists M7–M11 (updated in the planning entry); `execution-plan-m11.md` tasks + status flipped to done.
- **Tests / verification:** +5 net new TS tests (structuralTokens +3, workspaceAgentBackend summarize +2). All **1739 TS tests pass** (was 1734). svelte-check **0 errors** (185 warnings, same baseline as M9/M10). cargo test **17 passed**. Phase 3.5 is **complete**.

## 2026-06-19 17:20

- **Phase 3.5 M10 — Reactive-store + backend factory:** Closed the largest `[P2]` structural-duplication item from the phase-3.5 review. All four M10 tasks landed (T1–T4); see [execution-plan-m10.md](./ops/phase-3.5/execution-plan-m10.md). Pure refactor at the happy path with two small correctness improvements (per-key workspace-cache invalidation, snapshot-copy safety) — every store's existing test suite pins its behaviour unchanged.
- **Reactive-store factory (M10-T1):** New `app/src/lib/ai/opencodeResourceStore.ts` — `createReactiveResourceStore<TState, TKey>(opts)` encapsulates the cache + inflight-dedup + diagnostic + never-throws-degrade skeleton that was copy-pasted seven times. Per-store variance collapses to: `keyOf` (key arity — 1-arg workspace vs 2/3-arg per-session), `copyEmptyState` (M10-T3 fresh-copy injection), `disabledState` / `buildLoadingState` / `buildErrorState` (the config store overrides `buildErrorState` to preserve prior cached data on a transient reload — M7-T3), and the success-state `fetch` callback (the only real store-specific logic; not unified). A `reactive: true|false` flag encodes the deliberate reactivity split: the per-session stores (todo, diff) and the status-summary / file-status stores expose real Svelte `Readable`s (panels subscribe + re-render); the workspace catalog / config / commands stores are **pull-only** (settings panels read a snapshot on mount). Documented this in the factory so a future contributor reaching for `.subscribe` on a pull-only store hits a thrown error pointing at the rationale instead of a silently-empty subscription. Migrated all seven stores (`opencodeCatalog`, `opencodeConfigStore`, `opencodeCommands`, `opencodeTodoStore`, `opencodeDiffStore`, `opencodeStatusSummary`, `fileStatusTracker`) — every public accessor shape preserved, so no consumer changed.
- **Backend factory (M10-T2):** New `app/src/lib/ai/backends/opencodeBackendFactory.ts` — `createOpencodeBackendFromAppState()` reads `appState.getSnapshot().settings.opencode` once and returns a constructed backend (or `null` when disabled). Replaces the ~10 copy-pasted `resolveRuntimeConfig` + `createWorkspaceAgentBackend("opencode", { resolveRuntimeConfig })` closures. Adopted in the three `appShellAgentHandlers` closures (`:46-51`, `:175-180`, `:254-261`), the seven stores, and `opencodeSearch.ts`. The stores' disabled-check now collapses onto the `null` return (one short-circuit instead of a duplicated `isOpencodeEnabled` read).
- **Per-key invalidation + snapshot-copy (M10-T3):** Added `clearOpencodeCatalog(ws)` / `clearOpencodeConfigStore(ws)` / `clearOpencodeCommands(ws)` mirrors to the pull-only workspace stores (the per-session and reactive-workspace stores already had `clear*`). Wired a new workspace-switch effect in `routes/+page.svelte` so the process-lifetime cache doesn't accumulate an entry per workspace ever opened (slow leak in a long-running desktop app). Fixed the shared-`emptyState`-by-reference foot-gun: the factory's `copyEmptyState` injects a fresh copy per cache entry (`{ ...emptyState }`, plus `new Map()` for the file-status store whose state holds a mutable `statusByPath` map) so a consumer mutating a pre-refresh snapshot can't corrupt the singleton across sessions/workspaces.
- **listAndMap + factory tests (M10-T4):** Extracted the 4× copy-pasted M5 backend template (`workspaceAgentBackend.ts` `listSessionTodos` / `listSessionDiffs` / `listFileStatuses` / `listLspStatuses`) into a local `listAndMap<T>(fetch, mapper)` helper inside `createOpencodeBackend` — the four methods became one-liners, preserving the degrade-to-`[]` policy on `serverUnavailable | transportError | authFailure | notFound`. New `app/src/lib/ai/opencodeResourceStore.test.ts` (18 tests) pins the factory: cache isolation per key, snapshot-copy safety (distinct objects per entry), inflight dedup (single fetch for concurrent refreshes, parallel for distinct keys, re-refresh after settle), disabled `null`-backend degrade, error-state + non-Error fallback + custom `buildErrorState` prior-data preservation, `clear` / `resetForTests` / `setSnapshot`, the reactive-vs-pull-only split (`getReadable` throws on a pull-only store with a pointing-to-the-note message), and diagnostic emission (loaded=`debug` / error=`warn`, `diagnosticExtra` merge).
- **Tests / verification:** 18 new tests in `opencodeResourceStore.test.ts`; the seven pre-existing per-store suites (the regression net — 78 tests across `opencodeCatalog` / `opencodeConfigStore` / `opencodeDiffStore` / `opencodeStatusSummary` / `opencodeTodoStore` / `opencodeCommands` / `fileStatusTracker` + `appShellAgentHandlers`) pass **unchanged**. All **1734 TS tests pass** (was 1716 — +18 net new). svelte-check **0 errors** (185 warnings, all pre-existing-style, same count as the M9 baseline). Net ~270 production-line reduction (540 lines removed from the migrated stores vs 270 lines of new factory + helper). Marked `execution-plan-m10.md` M10-T1..T4 DONE — M10 is complete.



## 2026-06-19 16:24

- **Phase 3.5 M9 — Shared wire-reader extraction:** Closed the `[P2]` duplication item from the phase-3.5 review. Both M9 tasks landed (T1–T2); see [execution-plan-m9.md](./ops/phase-3.5/execution-plan-m9.md). Pure refactor — no behaviour change, no public-API change — that removes the ~120 lines of triplicated wire-reader primitives so the three reader sites stop drifting as the OpenCode wire shapes evolve.
- **Shared module (M9-T1):** New `app/src/lib/ai/backends/wireReaders.ts` exporting the canonical tolerant readers — `readObject`, `readString`, `readOptionalString`, `readNumber`, `readBoolean`, `readStringList`, `readTokenUsage` — with their contracts documented (notably `readString` returns `null` for whitespace-only, which is load-bearing for gating *required* fields; `readNumber` nulls `NaN`/`±Infinity`; `readTokenUsage` covers both `ChatTokenUsage` and the structurally-identical `WorkspaceAgentTokenUsage`).
  - Adopted in `opencodeSessionMessages.ts` — removed its 6 local readers (`readObject`/`readString`/`readNumber`/`readBoolean`/`readStringList`/`readOptionalString`/`readTokenUsage`); all semantics identical, direct reuse.
  - Adopted in `workspaceAgentBackend.ts` — removed the two local reader blocks (`readObject`/`readString`/`readBoolean` and `readNumber`/`readTokenUsage`); the local `readTokenUsage` previously returned `WorkspaceAgentTokenUsage`, but the shared reader's `ChatTokenUsage` is structurally identical so assignment into `step.finished.tokens` is unchanged.
  - Adopted in `chatPersistenceCodec.ts` — routed `parseOptionalNumber`/`parseOptionalBoolean` through `readNumber`/`readBoolean` (identical logic, only the `null`→`undefined` return shape differs). Kept `parseOptionalString` and `parseTokenUsage` codec-local: the codec's `parseOptionalString` deliberately accepts whitespace-only strings (disk round-trips them verbatim) and `parseTokenUsage` validates numbers with a plain `typeof === "number"` (no `Number.isFinite`) matching what was previously written to disk — both genuinely differ from the shared readers, so reusing directly would have changed tolerance for already-persisted data. The codec's fail-closed-on-bad-part behaviour (`parseParts`) stays at the codec boundary as before.
  - Did **not** touch `openAiSseParser.ts`'s local `readString` — it has a subtly different contract (`.length > 0`, non-whitespace-aware) and is not one of the three triplicated sites; keeping the diff mechanical per the milestone note.
- **Tests (M9-T2):** New `app/src/lib/ai/backends/wireReaders.test.ts` (27 tests) covering the readers the shared module now owns — including the load-bearing whitespace-only `readString → null` and `readOptionalString → undefined` edge cases that were not previously pinned at the unit level, `readNumber` `NaN`/`Infinity` rejection, `readStringList` non-string drop, and `readTokenUsage` missing-field / non-finite / non-object rejection. The pre-existing `opencodeSessionMessages.test.ts` / `workspaceAgentBackend*.test.ts` / `chatPersistence*.test.ts` suites (which pin the reader semantics at the integration level) pass **unchanged**. All **1716 TS tests pass** (was 1696 — +20 net new). svelte-check **0 errors** (185 warnings, all pre-existing-style). Marked `execution-plan-m9.md` M9-T1..T2 DONE — M9 is complete.



- **Phase 3.5 M8 — M1 live-stream parts wiring:** Closed the headline `[P1]` functional gap from the phase-3.5 review — reasoning, subtask, and step parts now render **during** a live workspace-agent turn, not only after the turn finishes and the tab is reopened (which triggers M1-T3 `session.messages` hydration). Both M8 tasks landed (T1–T2); see [execution-plan-m8.md](./ops/phase-3.5/execution-plan-m8.md). This directly satisfies the M1 exit criterion "Workspace agent transcript renders reasoning, subtask, step, diff, and attachment parts" for the **live** case (M1-T3 only covered the hydrated case).
- **Live-stream parts (M8-T1):** The `chatSendPipeline.ts` `for await` loop over `backend.streamEvents(...)` previously handled only `message.delta`/`message.completed`/`tool.*`/`run.failed`/`permission.requested`/`question.requested`; the M1-T2 events (`reasoning.*`/`subtask.started`/`step.*`) fell through and were silently dropped, so during a long agentic turn the user saw flat text + tool cards only. The loop now maintains a local `parts: ChatMessagePart[]` accumulator (mirroring `accumulated` text + `toolCalls`) and upserts reasoning/subtask/step parts on each relevant event via the new helper, calling `chatStore.updateMessageParts(assistantMessage.id, parts, activeAgentId, root)` incrementally — true live rendering. `message.completed` flushes the accumulated parts once (idempotent via a `hasFlushedParts` guard); a second idempotent flush after the loop covers turns that end via `run.completed` without a final `message.completed`. Per the chosen approach, **no end-of-turn `listMessages` re-hydration was added** — the live path is the single source. (`app/src/lib/ai/chatSendPipeline.ts:753-880`.)
- **chatStreamParts helper (M8-T1):** New `app/src/lib/ai/chatStreamParts.ts` — pure incremental part-upsert helpers mirroring the `applyToolStarted`/`applyToolCompleted` style from `toolCallReducer.ts` (each takes the current parts array + a structurally-typed event, returns the next array). Input types are declared locally (not imported from the backend) so the helper is unit-testable in isolation and stays decoupled from the transport layer. `applyReasoningDelta` (merge by `reasoningId`, fold into the first id-less part when null, no-op on empty delta), `applyReasoningEnded` (finalize with authoritative text; create-when-standalone), `applySubtaskStarted` (upsert by `subtaskId`, append for null ids), `applyStepStarted` (synthesize index = count of step-start parts, matching `opencodeSessionMessages`'s increment-on-finish semantics; idempotent for re-emitted known stepIds), `applyStepFinished` (pair finish with start by `stepId`, fall back to the most-recent open start for null stepIds), `applyStepFailed` (emit a token-less finish so `extractMessageSteps` surfaces it as `status: "failed"`, carrying the error message as the finish `reason`). Part shapes match `opencodeSessionMessages.ts` so live and hydrated views are visually consistent.
- **Tests (M8-T2):** 22 new tests in `app/src/lib/ai/chatStreamParts.test.ts` (incremental reasoning delta merge, reasoning-finalize incl. standalone + id-less, subtask upsert-by-id + append-for-null + omit-null-fields, step-start synthesized index + increment + idempotent re-emit, step-finish pairing by stepId + ordering + orphan-open-start via null stepId, step-failed token-less finish + extractor surfaces `failed`, ordering invariant across reasoning/subtask/step, reference-stability for no-op re-applies). Extended `chatSendPipeline.test.ts` with 2 end-to-end streaming-turn tests: a turn emitting `reasoning.delta`/`step.started`/`subtask.started`/`step.finished`/`reasoning.ended` results in an assistant message whose `parts` reflect all three (asserted via `message.parts` snapshot), and a `step.failed` event surfaces as a token-less finish part. All **1696 TS tests pass** (was 1672 — +24 net new). svelte-check **0 errors** (185 warnings, all pre-existing-style). Marked `execution-plan-m8.md` M8-T1..T2 DONE — M8 is complete.

## 2026-06-19 14:40

- **Phase 3.5 M7 — Critical bugfixes:** Closed the five `[P0]` correctness defects surfaced in the phase-3.5 architecture & code-quality review. All five M7 tasks landed (T1–T5); see [execution-plan-m7.md](./ops/phase-3.5/execution-plan-m7.md). These are isolated, low-risk fixes that unblock declaring phase 3.5 functionally complete.
- **promptHistory arrow-down (M7-T1):** `nextHistoryDown` skipped the index-0 entry — arrow-down from index 1 jumped straight to the empty draft because the `next <= 0` guard fired for `next === 0` and returned `null`. Removed the spurious inner guard; the outer `currentIndex <= 0` branch already covers the "at/below the draft" short-circuit. From index 1 → index 0, from index 0 → empty draft. (`app/src/lib/services/promptHistory.ts`.) The existing test that asserted the buggy `index 1 → empty draft` was flipped; added clamp-at-bottom + below-draft no-op cases.
- **opencodeDiffStore keyed by messageId (M7-T2):** `refreshSessionDiffs` accepts/forwards a `messageId` but `stateKey` (and therefore `storeCache`/`inflightRequests`) was only `${workspaceRootPath}|${sessionId}` — a scoped refresh (`messageId=A`) racing or caching against another scope returned the wrong message's files. Folded `messageId ?? "all"` into `stateKey`, threading it through `getOrCreateStore`/`setState`/`getSessionDiffs`/`getSessionDiffSnapshot`/`refreshSessionDiffs`/`clearSessionDiffs` (public accessors kept backward-compatible — `messageId` is optional). Created `app/src/lib/ai/opencodeDiffStore.test.ts` (the store previously had no test file): 7 tests covering cache isolation per messageId, whole-session vs scoped isolation, per-messageId clear, inflight dedup honours messageId, concurrent `messageId=A`/`messageId=B` don't cross-resolve, snapshot reflectiveness, error degradation.
- **opencodeConfigStore transient-reload (M7-T3):** `loadOpencodeConfigStore`'s error branch overwrote the previously-good `config`/`providers`/`mcp`/`agents`/`skills` with `emptyState`, so a flaky re-load cleared the in-memory config that `savePermissionConfig` depends on (it returns `false` when `current.config` is null, even though the server still holds the config). On a transient `getConfig` failure during a re-load the prior cached slices are now preserved and only `status → "error"` + `lastErrorMessage` flip; a genuine first-load failure (no prior data) still degrades to `emptyState`. (`app/src/lib/ai/opencodeConfigStore.ts`.) New `app/src/lib/ai/opencodeConfigStore.test.ts` (3 tests): successful-then-failing reload keeps prior config/providers and marks error; first-load failure still empties; full-view success.
- **handleOpenExternalSession hydration (M7-T4):** A tab opened from the unified session list was created with a placeholder `title: "Opened session"` and never hydrated (unlike `handleForkAgent`); the placeholder + empty message list persisted until the user reopened the tab. Now seeds `title` from `getSessionDetails` (best-effort, falls back to the caller-supplied title / placeholder) and calls `hydrateWorkspaceAgentMessages` after creating the tab (best-effort, wrapped in `.catch(() => {})` matching the M2 convention). (`app/src/lib/services/appShellAgentHandlers.ts`.) Extended `appShellAgentHandlers.test.ts` — opening an external session triggers best-effort hydration + title seeding; getSessionDetails failure falls back to the caller title; hydration failure does not throw.
- **handleListWorkspaceSessions diagnostic (M7-T5):** A bare `catch {}` returned `[]` with no diagnostic, inconsistent with every sibling handler (and leaving the consumer `+page.svelte`'s own try/catch as unreachable dead code). The catch now emits a diagnostic (`opencode.session.list` kind, matching the existing `emitDiagnostic` convention) while keeping the degrade-to-`[]` contract. Removed the now-dead consumer `catch` in `routes/+page.svelte`'s `refreshSessionList` (the error state is permanently `null` since the handler never throws — diagnostics replace the in-band error surface). (`app/src/lib/services/appShellAgentHandlers.ts`, `app/src/routes/+page.svelte`.) Tests assert a diagnostic is emitted on backend failure and the degrade-to-`[]` contract is unchanged.
- **Tests / verification:** 17 new tests across 3 files (promptHistory +4 net, opencodeDiffStore +7, opencodeConfigStore +3, appShellAgentHandlers +6 net for the external-session + session-list cases). All **1672 TS tests pass** (was 1655 — +17 net new). svelte-check **0 errors** (185 warnings, all pre-existing-style). Marked `execution-plan-m7.md` M7-T1..T5 DONE — M7 is complete.

## 2026-06-19 10:30

- **Phase 3.5 post-review follow-up plan (M7–M11):** Ran an architecture & code-quality review of phase 3.5 (M0–M6, all tasks DONE; 1655 TS + 17 Rust tests passing, `svelte-check` 0 errors). All milestones are implemented, but the review surfaced one `[P1]` functional gap and several `[P0]`/`[P2]` items. Authored five follow-up execution plans and sequenced them for development flow. **No code changed** — docs only.
- **Findings → milestones:**
  - **M7 — Critical bugfixes** (`[P0]`, [execution-plan-m7.md](./ops/phase-3.5/execution-plan-m7.md)): `promptHistory.nextHistoryDown` skips index 0 (`promptHistory.ts:285-292`); `opencodeDiffStore` cache/inflight key excludes `messageId` so scoped refreshes return the wrong message's files — plus the store has no test file (`opencodeDiffStore.ts:33,121`); `loadOpencodeConfigStore` error branch wipes previously-good cached config that `savePermissionConfig` depends on (`opencodeConfigStore.ts:186-196`); `handleOpenExternalSession` never hydrates the new tab (`appShellAgentHandlers.ts:586-616`); `handleListWorkspaceSessions` silently swallows errors with no diagnostic, inconsistent with every sibling handler (`appShellAgentHandlers.ts:636-639`).
  - **M8 — M1 live-stream parts wiring** (`[P1]`, [execution-plan-m8.md](./ops/phase-3.5/execution-plan-m8.md)): the headline gap. M1-T2 added `reasoning.*`/`subtask.started`/`step.*` to `WorkspaceAgentStreamEvent`, but `chatSendPipeline.ts:753-869` never turns them into parts — reasoning/subtask/step only render after the tab is reopened (M1-T3 hydration), not during the live turn. Plan: handle the new event types in the stream loop and call `chatStore.updateMessageParts` incrementally (true live rendering; no end-of-turn `listMessages` re-hydration). The `updateMessageParts` store API already exists (`threadMessages.ts:278-327`) but was unused for these events.
  - **M9 — Shared wire-reader extraction** (`[P2]`, [execution-plan-m9.md](./ops/phase-3.5/execution-plan-m9.md)): `readObject/readString/readNumber/readBoolean/readStringList/readTokenUsage` are triplicated across `opencodeSessionMessages.ts`, `workspaceAgentBackend.ts`, and `chatPersistenceCodec.ts` (~120 redundant lines). Extract to one `wireReaders.ts`; pure no-behaviour-change dedup.
  - **M10 — Reactive-store + backend factory** (`[P2]`, [execution-plan-m10.md](./ops/phase-3.5/execution-plan-m10.md)): the cache+inflight+diagnostic store pattern is copy-pasted 7× across the workspace-agent services (~600 lines); `resolveRuntimeConfig`/`createBackend` closures duplicated ~10×; workspace stores lack per-key invalidation (slow leak) and the four M5 stores share `emptyState` by reference (snapshot-mutation foot-gun); M5 backend `listAndMap` template duplicated 4×. Generic factory + `createOpencodeBackendFromAppState()` helper collapse it.
  - **M11 — Polish & spec housekeeping** (`[P1]`/`[P2]`, [execution-plan-m11.md](./ops/phase-3.5/execution-plan-m11.md)): non-monotonic `--space-*` token scale with duplicate values (`tokens.css:13-21`); decide+document `compaction`/`cost` part render path (compaction has no UI consumer); minor correctness (`summarizeSession` stringly-boolean, `mapAgentEntry` dropped `isSubagent`, misleading debounce comment, immutable/mutating mix in `composerPromptQueue`/`promptHistory`, `formatCost` zero-vs-missing ambiguity); and the spec housekeeping that formally closes phase 3.5 — tick the exit-criteria checklist in `phase-3.5.md` (still all `[ ]`), flip `Status: draft`.
- **Index updated:** [execution-plan.md](./ops/phase-3.5/execution-plan.md) now lists M7–M11 with their dependency order and a short sequencing note.

## 2026-06-18 18:00

- **Phase 3.5 M6 — Appearance & feedback:** font size scaling, sound + OS notifications, and theme-token gap fixes for the new phase-3.5 surfaces. All six M6 tasks landed (T1–T6); see [execution-plan-m6.md](./ops/phase-3.5/execution-plan-m6.md). Keybind customization (T3) was already fully implemented in prior milestones (`commands/commandBindings.ts` + `commandBindingRuntime.ts` + `KeyboardShortcutsSettings.svelte`), so M6 added a persistence round-trip test rather than new code.
- **Theme compatibility (M6-T1):** The phase-3.5 components (ReasoningBlock, SubtaskCard, TodoPanel, StatusPopover, SessionListPanel, DiffViewerPanel, SessionTimelineDialog, …) — plus pre-existing CSS in `chat-composer.css` / `chatProse.css` — referenced structural CSS variables that were never defined: spacing scale `--space-1/3/5/10`, and `--color-border-strong`, `--color-selection`, `--color-surface-0/2`, `--color-danger`. Added all of them to `styles/tokens.css` for both light and dark (derived from the existing palette via `color-mix`); no new theme library or picker, per [questions.md Q8](./ops/phase-3.5/questions.md). New `styles/structuralTokens.test.ts` (13 tests) pins their presence so the gaps don't silently regress.
- **Font size configuration (M6-T2):** New `services/fontSettings.ts` — per-surface scale (UI / editor / chat) clamped to 60–200%, default 100% (preserves the pre-M6 13px base). New `state/appState/fontSettingsSlice.ts` writes `--font-size-ui/editor/chat` CSS variables onto `:root` on change and at startup. `body` now uses `--font-size-ui`; `EditorSurface` initial state + `editorCommandRunner.applyZoom` read `--font-size-editor` instead of a hardcoded 13 (zoom composes editor-scale × zoomPercent); `.chat-prose` uses `--font-size-chat`. Persisted under `fontSettings` in `settings.json` via the existing `PersistedSettings` / `applyPersistedSettings` / `syncSettingsPersistenceEffect` pipeline. New **Appearance** settings tab (`AppearancePanel.svelte`) with three sliders + reset.
- **Sound notifications (M6-T4):** New `services/soundNotifications.ts` — synthesizes a distinct two-note WebAudio tone per event (agentDone / permission / question / error; no asset files needed), gated by master enable + per-event toggles + 0–100 volume. Shared `AudioContext` is lazily created and resumed on first use; `getAudioContext` returns an injected/test context before requiring the native constructor. New `services/notificationSettings.ts` holds the shared `SoundSettings` / `OsNotificationSettings` types + defaults + normalizers; new `state/appState/notificationSettingsSlice.ts` exposes the toggle actions. Toggles + volume + per-event preview live in the Appearance panel.
- **OS notifications (M6-T5):** New `services/osNotifications.ts` — uses the webview `Notification` API, requests permission lazily, and is gated by `document.hidden` (only fires when the SpecOps window is not focused) plus master + per-event toggles. Wiring is non-intrusive: new `services/agentNotificationObserver.ts` exposes a pure `deriveNotificationEvents(prev, current)` (maps chatStore runtime transitions → events: `isGenerating` true→false = agentDone, fresh `lastFailedTurnId` = error, `isWaitingForPermission/Question` false→true = permission/question) plus a `createAgentNotificationObserver` factory that tracks per-agent previous state and dispatches to the sound/OS sinks. A new `chatActiveRuntimeByAgentId` derived store feeds it; the observer effect in `routes/+page.svelte` runs on every chatStore change. No edits to `chatSendPipeline.ts`.
- **Tests (M6-T6):** 67 new tests across 8 files: `fontSettings.test.ts` (11 — defaults, clamp/round/non-numeric fallback, round-trip, px math), `notificationSettings.test.ts` (10 — defaults, partial-merge, volume clamp, non-boolean-flag ignore, event-id order), `soundNotifications.test.ts` (5 — distinct tones, master/per-event gating, oscillator-per-note, no-context no-op), `osNotifications.test.ts` (6 — per-event copy, window-focus gate, master/per-event gating, permission-denied), `agentNotificationObserver.test.ts` (13 — transition derivation incl. multi-event + fresh-failure + scope-reset, dispatch with injected sinks, per-agent independence), `fontSettingsSlice.test.ts` (3 — CSS-var application + slice update), `structuralTokens.test.ts` (13 — spacing scale, font-size vars, body application, color tokens per theme), `settingsStore.test.ts` (+9 — keybind + appearance persistence round-trips). All **1655 TS tests pass** (was 1588 — +67 net new). svelte-check **0 errors** (185 warnings, all pre-existing-style). Marked `execution-plan-m6.md` M6-T1..T6 DONE — M6 is complete.

## 2026-06-18 17:00

- **Phase 3.5 M6 scope update:** Restored M6-T4 (sound notifications) and M6-T5 (OS notifications) from backlog into active M6 scope; removed both from [backlog.md](./backlog.md). Narrowed M6-T2 to font **size** only — keep existing mono/sans font families, no system font picker. Updated [execution-plan-m6.md](./ops/phase-3.5/execution-plan-m6.md), [phase-3.5.md](./ops/phase-3.5/phase-3.5.md), and [questions.md Q9](./ops/phase-3.5/questions.md) to match.

## 2026-06-18 16:20

- **Phase 3.5 M5 — Workspace UX:** TODO panel, session diff viewer, project-tree file-change badges, status popover, and session timeline — the agent-adjacent surfaces OpenCode Desktop exposes. All six M5 tasks landed (T1–T6; T6 embedded terminal deferred per [questions.md Q7](./ops/phase-3.5/questions.md)); see [execution-plan-m5.md](./ops/phase-3.5/execution-plan-m5.md).
- **Backend (M5-T1..T4):** Extended `WorkspaceAgentBackend` + `RawOpencodeClient` (`app/src/lib/ai/backends/workspaceAgentBackend.ts`) with the v2 SDK workspace-UX endpoints: `listSessionTodos` (`session.todo` → `OpencodeTodoEntry[]`), `listSessionDiffs` (`session.diff` with optional `messageID` scope → `OpencodeSessionFileDiff[]`), `listFileStatuses` (`file.status` → `OpencodeFileStatusEntry[]`), `listLspStatuses` (`/lsp` → `OpencodeLspStatusEntry[]`). New mappers tolerant of missing optional fields: `mapTodoEntry` (drops content-less entries, coerces unknown status→`pending` / priority→`medium`), `mapSessionFileDiff` (defaults status→`modified`, counts→0), `mapFileStatusEntry` (tolerates `added`/`removed` aliases for additions/deletions), `mapLspStatusEntry` (defaults unknown status→`error`). All four degrade to `[]` on transport/auth/notFound errors so the panels never block on a flaky server. `cursor-local` backend stubs throw `NotImplemented`; shared `rawOpencodeClientStub.ts` test helper gained the four methods.
- **TODO panel (M5-T1):** New `ai/opencodeTodoStore.ts` — per-session reactive store (`writable` keyed by `${workspaceRoot}|${sessionId}`) wrapping `session.todo` with the cache + inflight pattern; never throws (degrades to `error` state). Pure helpers `sortSessionTodos` (in_progress→pending→completed→cancelled, then high→medium→low) + `summarizeTodoProgress` (completed/total/fraction). New `TodoPanel.svelte` renders a status-grouped checklist with progress badge, manual refresh, and click-to-jump. Wired as a right-side rail in `AppShell` (new `todoPanel` prop), toggled from a `Todos` button in the `ChatPanel` header; `+page.svelte` auto-refreshes on panel-open / session-switch / turn-completion (re-fetch after the `isGenerating` transition lands the `todowrite` result) and clears stale per-session cache on agent switch.
- **Diff viewer (M5-T2):** New `ai/chatDiffParser.ts` — pure unified-diff parser (`parseUnifiedDiffPatch` walks `@@ -a,b +c,d @@` hunk headers tracking old/new line numbers; emits added/removed/context/hunk/meta rows), `parseSessionDiffs`, `filterSessionDiffs` (all/modified/added/deleted), `summarizeSessionDiffs`, `diffStatusBadgeLabel`, `splitDiffFilePath`. New `ai/opencodeDiffStore.ts` (reactive `session.diff` store mirroring the todo pattern). New `DiffViewer.svelte` (unified + split view modes; split keeps columns aligned via padding rows) + `DiffViewerPanel.svelte` (file-list sidebar with status badges + +/- counts, unified/split toggle, filter chips, per-file open). Wired as a `diffPanel` rail in `AppShell`, toggled from a `Changes` button in `ChatPanel`; double-click a file (or the Open button) opens it in the editor (workspace-relative paths resolved to absolute via `resolveWorkspaceRelativePath`).
- **File change tracking (M5-T3):** New `services/fileStatusTracker.ts` — per-workspace reactive store wrapping `file.status` with `resolveAbsoluteStatusMap` (relative→absolute), `fileStatusBadgeLabel` (M/A/D), `summarizeFileStatuses`. Threaded `statusByPath` map through `ProjectTreeView` → `ProjectTreeList` → `ProjectTreeNode`, which renders a one-letter status badge (M/A/D) tinted by status on each row. `+page.svelte` auto-refreshes on workspace-switch / turn-completion and clears stale per-workspace cache.
- **Status popover (M5-T4):** New `ai/opencodeStatusSummary.ts` — per-workspace reactive store aggregating LSP (`/lsp`), MCP (`mcp.status` connected/total), providers (`provider.list` connected/total), and config-derived permission-rule count + default model/agent; each source fetched in parallel and degraded independently (`readConfigSummary`, `countPermissionRules` tolerates bare-action / per-tool-map / array shapes). New `StatusPopover.svelte` (anchored popover with model/agent/LSP/MCP/provider/permission rows; rows double as quick-links into the relevant settings tab via `openSettingsDialog`; outside-click + Escape close). `TitleBar.svelte` gained a right-anchored status button (●) gated to "workspace open + OpenCode enabled". `+page.svelte` refreshes the summary when the popover opens / workspace changes and clears stale cache.
- **Session timeline (M5-T5):** New `SessionTimelineDialog.svelte` — modal scrollable list of every transcript message with role + timestamp + preview, content/role search filter, and click-to-jump. Triggered from a `Timeline…` entry in the `ChatPanel` Session menu. Jump dispatches a `specops:scroll-to-message` window event that `ChatMessageList` listens for (new `data-message-id` attribute + `onMount`/`onDestroy` listener + smooth `scrollIntoView`) to center the target message.
- **Embedded terminal (M5-T6):** Deferred to a later phase per [questions.md Q7](./ops/phase-3.5/questions.md) — not in phase 3.5 scope; tracked in backlog. No code landed; `cursor-local`/backend surface unaffected.
- **Tests (M5-T7):** 55 new tests across 5 files: `workspaceAgentBackendWorkspaceUx.test.ts` (14 — todo mapping/drop-empty/coerce-unknown/transport-degrade/non-array, diff mapping/defaults-missing/notFound-degrade, file status mapping/added-removed-alias/drop-empty/transport-degrade, lsp mapping/drop-missing/coerce-status/authFailure-degrade), `chatDiffParser.test.ts` (16 — hunk header extract/single-line/non-hunk, patch context/added/removed with line-number tracking, multi-row increment, no-newline marker, empty patch, in-hunk blank-as-context, parseSessionDiffs, filter by status/all, summarize, badge labels, path split), `fileStatusTracker.test.ts` (8 — relative→absolute resolution, absolute pass-through, drop-empty, duplicate-keeps-last, trailing-slash strip, badge labels, status counts), `opencodeTodoStore.test.ts` (8 — status ordering, priority tie-break, immutability, progress fraction incl. empty + cancelled-excluded, constant lists), `opencodeStatusSummary.test.ts` (9 — permission count for bare-action/per-tool-map/array/null, config summary extraction incl. blank/null model-agent + non-object permission). All 1588 TS tests pass (was 1533 — +55 net new, 0 new failures). svelte-check **0 errors** (183 warnings — all pre-existing-style unused-CSS-selector warnings; +7 from the new component styles, consistent with existing panels). Marked `execution-plan-m5.md` M5-T1..T7 DONE — M5 is complete.

## 2026-06-18 15:15

- **Phase 3.5 M4 — Configuration management:** Full visual editors for OpenCode config, providers, MCP servers, agents, permissions, slash commands, and instructions/skills — the "better than OpenCode" differentiator. All nine M4 tasks landed (T1–T9); see [execution-plan-m4.md](./ops/phase-3.5/execution-plan-m4.md).
- **Backend (M4-T1..T8):** Extended `WorkspaceAgentBackend` + `RawOpencodeClient` (`app/src/lib/ai/backends/workspaceAgentBackend.ts`) with the v2 SDK config / provider / mcp / app endpoints: `getConfig`/`updateConfig` (`config.get`/`config.update`), `listProviderStatuses` (`provider.list` → `{all, connected}` merged into status entries with model counts), `setProviderApiKey`/`removeProviderAuth` (`auth.set`/`auth.remove`), `startProviderOAuth`/`completeProviderOAuth` (`provider.oauth.authorize`/`callback`), `listMcpStatuses`/`addMcpServer`/`connectMcpServer`/`disconnectMcpServer` (`mcp.status`/`add`/`connect`/`disconnect`), `listSkills` (`app.skills`), `listAgentDetails` (`app.agents` → richer `Agent` shape). New mapper functions tolerant of missing optional fields: `mapConfigDocument`, `mapProviderStatus`, `mapMcpStatuses`, `mapSkillEntry`, `mapAgentDetail`, `readOAuthUrl` (tolerates bare-string / `{url}` / `{data:{url}}` / `{data:"url"}` shapes). Auth / connect / disconnect helpers return `false` (rather than throwing) on `authFailure`/`notFound` so the panels can show a friendly message; `listSkills` degrades to `[]` on transport errors. `cursor-local` backend stubs throw `NotImplemented` for all new methods.
- **Config helpers (M4-T1/T4/T5/T6):** New `ai/backends/opencodeConfig.ts` — pure, DOM-free typed getters/setters over the loose `OpencodeConfigDocument`. Getters read scalar fields (`model`, `small_model`, `default_agent`, `username`, `share`, `autoupdate`, `snapshot`), nested objects (`tool_output`, `compaction`, `experimental`, `skills`), and arrays (`instructions`) with type coercion + sane fallbacks. Setters return NEW documents (immutability so callers diff before persisting) and drop keys when values are blank/empty so round-trips never persist `model: ""`. Agent (`agent:`) and command (`command:`) maps map to/from `OpencodeAgentConfigEntry` / `OpencodeCommandConfigEntry` (snake_case round-trip via `agentConfigEntryToRaw`/`commandConfigEntryToRaw`); `setConfigAgent`/`removeConfigAgent`/`setConfigCommand`/`removeConfigCommand` upsert/remove with empty-map pruning. Permission config (`permission:`) — polymorphic bare-action or per-tool map — exposes `getConfigPermissionRules` (extracts `{permission, pattern, action}` rows from `{tool: {pattern: action}}`), `buildPermissionMap` (groups rows back into the per-tool map, dropping blanks/invalid actions), `addPermissionRule`/`updatePermissionRule`/`removePermissionRule` array helpers, plus `PERMISSION_TOOLS` / `PERMISSION_ACTIONS` constants. JSON tab helpers `serializeConfigJson` (2-space pretty, `$schema` first via `sortConfigKeys`) + `parseConfigJson` (rejects non-object top-level).
- **Service (M4-T1..T5):** New `ai/opencodeConfigStore.ts` — per-workspace reactive config-management service mirroring the cache + inflight + diagnostic pattern of `opencodeCatalog.ts`. `loadOpencodeConfigStore` fetches config + providers + MCP + agents + skills in parallel; provider/MCP/agent/skill failures are non-fatal (degrade to `[]` with a warn diagnostic) so a flaky endpoint doesn't block the whole panel, only a config-fetch failure surfaces as error state. `saveOpencodeConfig` replaces the document via `config.update`. Dedicated helpers `setProviderApiKey`/`removeProviderAuth`/`startProviderOAuth`/`completeProviderOAuth`/`addMcpServer`/`connectMcpServer`/`disconnectMcpServer`/`savePermissionConfig` each refresh the relevant cache slice after a successful mutation. `isConfigStoreAvailable` gates the panels to "OpenCode enabled + active workspace root".
- **UI:** Seven new settings panels under a Workspaces section in `SettingsDialog`: `OpenCodeConfigPanel.svelte` (M4-T1/T8 — Form + Raw JSON tabs; Form renders sections for Models & agent, Sharing & updates, Tool output truncation, Compaction, Instructions, Skills, Experimental; local `draft` working copy synced from store on load, edited in place, saved on demand; switching to JSON tab syncs the parsed draft so manual edits aren't lost), `ProviderManagementPanel.svelte` (M4-T2 — per-provider rows with Connected/Not connected badge + model count, API-key connect, OAuth button that opens the auth URL via `window.open`, disconnect), `McpManagementPanel.svelte` (M4-T3 — server list with status badges, inline add form toggling local (stdio: command+args/cwd/env) vs remote (HTTP/SSE: url/headers), connect/disconnect per server), `AgentManagementPanel.svelte` + `AgentEditorDialog.svelte` (M4-T4 — built-in + custom agent list with mode/model tags, modal editor with name/model/mode/description/prompt/steps/temperature/topP, save writes to `agent:` key, built-ins open read-only), `PermissionRulesPanel.svelte` (M4-T5 — per-rule rows with tool select / glob pattern input / action select, add/remove/save, shows the global default), `CommandManagementPanel.svelte` (M4-T6 — config-defined command list, inline editor with name/description/agent/template/subtask, writes to `command:` key), `InstructionsPanel.svelte` (M4-T7 — textarea editors for `instructions:` paths + `skills:` paths/urls, read-only discovered-skills list). `settingsDialogUi.ts` + `SettingsDialog.svelte` wired the seven new tabs (Config, Providers, MCP servers, Agents, Permissions, Commands, Instructions) into the Workspaces sidebar group. `settingsDialogUi.test.ts` updated for the new tab list.
- **Test-helper refactor:** The `RawOpencodeClient` interface grew by 14 M4 methods, so all inline client stubs in `workspaceAgentBackend.test.ts` (7 stubs) and `workspaceAgentBackend.messages.test.ts` (1 stub) were refactored to build on the shared `createRawOpencodeClientStub({...overrides})` helper rather than re-declaring every method — keeps them from drifting out of sync as the surface grows and lets each test only spell out the methods it cares about.
- **Tests (M4-T9):** 60 new tests across 2 files: `opencodeConfig.test.ts` (39 — top-level getters with fallbacks/coercion/present-values, setters immutability + blank-dropping + key-pruning, agent map read/round-trip/add/remove/no-op/blank-name, command map read/template-required/round-trip/add/remove, permission global-action detection + default read + rule extraction + map building + blank/invalid drop + set/update/remove + array helpers, JSON serialize/parse round-trip + non-object rejection + invalid-JSON rethrow + key-sort), and `workspaceAgentBackendConfig.test.ts` (21 — getConfig unwrap/non-object, updateConfig forward+map, full round-trip, provider status mapping with model counts + malformed→[], setProviderApiKey forward + authFailure→false, removeProviderAuth forward, startProviderOAuth bare-string/url-field/data-wrapper, completeProviderOAuth forward, MCP status mapping + addMcpServer forward+map + connect forward + connect notFound→false + disconnect, listSkills mapping + transport-degrade, listAgentDetails rich mapping + non-array→[]). All 1533 TS tests pass (was 1473 — +60 net new, 0 new failures). svelte-check **0 errors** (176 warnings — all pre-existing unused-CSS-selector warnings from shared stylesheet imports, consistent with existing panels). Marked `execution-plan-m4.md` M4-T1..T9 DONE — M4 is complete.

## 2026-06-18 14:25

- **Phase 3.5 M3 — Composer enhancements:** Workspace agent composer now supports slash commands, `@` mentions (files + agents), drag-and-drop file attachments, frecency-ordered prompt history, and queued/steered prompts while a turn is running. All six M3 tasks landed (T1–T6); see [execution-plan-m3.md](./ops/phase-3.5/execution-plan-m3.md).
- **Backend (M3-T1/T2/T3):** Extended `WorkspaceAgentBackend` + `RawOpencodeClient` (`app/src/lib/ai/backends/workspaceAgentBackend.ts`) with `listCommands` (wraps the v2 `/api/command` endpoint, falls back to v1 `/command` on 404) and `findFiles` (wraps `fs.find` with `type:"file"`, debounced client-side). Both degrade to `[]` on transport / auth / notFound errors so the composer never blocks on a flaky server. Added `OpencodeCommandEntry` (`{name, template, description?, agent?, subtask?}`) and `OpencodeFileSearchEntry` (`{path, type, mime}`) plus `mapCommandEntry` / `mapFileSearchEntry` mappers (tolerant of missing optional fields; drops entries without a non-empty name/template/path). `WorkspaceAgentSendRequest` gains an optional `context?: WorkspaceAgentSendContext` carrying `{filePaths?, agentNames?, attachments?}`; the SDK client's `buildPromptParts` now assembles the prompt `parts` array — text prompt first, then a `text` part enumerating file-mention paths, then `agent` parts per agent mention, then `file` parts per attachment (filtered to non-empty url/mime). `cursor-local` backend stubs throw `NotImplemented` for the new methods. New mappers `opencodeCommands.ts` (per-workspace cached command catalog + `filterCommands` / `shouldTriggerSlashPopover` / `buildSlashReplacement` pure helpers) and `opencodeSearch.ts` (`searchMentionFiles`, `filterMentionAgents`, `shouldTriggerMentionPicker`, `buildMentionReplacement`, `mentionTokenForFile`/`mentionTokenForAgent`).
- **Composer state + context (M3-T1..T3):** New `ai/composerContext.ts` with `buildSendContext({mentions, attachments})` → `WorkspaceAgentSendContext | undefined` (returns undefined when nothing is attached so the pipeline skips the `context` field), `isImageMime` / `inferAttachmentMime` (file-type/extension → mime, falling back to `application/octet-stream`), and `ComposerAttachment` shape for the tray. `composerSendActions.ts` `submitMessage` now accepts `ComposerSendOptions` (`{context?, onAfterSend?}`) and forwards context into `sendChatMessage`; the `isGenerating` guard moved out (the composer handles queue/steer before calling submit).
- **Pipeline (M3-T5):** `ChatSendContextOptions` gains `context?: WorkspaceAgentSendContext` and `queueMode?: ChatQueueMode` (`"queue" | "steer"`). `executeProviderTurn` / `executeWorkspaceAgentBackendTurn` thread `context` through; `backend.send` forwards it so attachments/mentions land in the OpenCode prompt `parts`. New `ai/composerPromptQueue.ts` — a tiny client-side queue manager (`enqueue`, `takeNextDeliverable`, `takeNextSteer`, `remove`, `clear`, `snapshot`) with stable unique ids per item.
- **Prompt history (M3-T4):** New `services/promptHistory.ts` — per-workspace frecency-ordered prompt history persisted to `appDataDir/spec-ops/prompt-history/<sanitized-workspace>.json` (best-effort; disk failures degrade to in-memory). `frecencyScore` = `count * (1 / (1 + ageDays/7))` (recency-weighted frequency, floored at 0.01 so old entries aren't zeroed). `nextHistoryUp`/`nextHistoryDown` implement the arrow-up/arrow-down cycling contract (up at index -1 → top entry; down at index 0 → empty draft). Capped at 100 entries (configurable).
- **UI:** New components — `SlashCommandPopover.svelte` (listbox of filtered commands with active-index highlight, loading/error/empty states), `MentionPicker.svelte` (Files/Agents sections merged into a single keyboard-navigable row set — files first, then agents), `AttachmentTray.svelte` (file-picker button + drag-and-drop target, image thumbnails via object URLs, per-chip remove with blob-URL revocation, size formatting). `ChatComposer.svelte` rewritten to integrate all four features: workspace-only `/` and `@` trigger detection on every caret move, debounced file search (180ms), keyboard navigation (Up/Down/Enter/Esc) for both popovers, mention chips with remove, attachment chips with revoke on clear, prompt-history cycling gated to caret-at-boundary, queued-prompt chips with a Queue/Steer mode toggle and Clear button. A `$effect` watches the `isGenerating` transition and drains queue-mode items once a turn completes; steer mode aborts the running turn (via a new `onAbortTurn` prop wired from `ChatPanel` → `abortTurn`) and re-sends immediately. The Send button label flips to "Queue" while generating with queued items. New styles appended to `app/src/lib/styles/chat-composer.css` for the popovers, mention/queued-prompt chips, and the input-wrapper that anchors popovers above the textarea.
- **Tests (M3-T6):** 96 new tests across 6 files: `opencodeCommands.test.ts` (20 — filter by name/description/empty/whitespace/no-match/input-safety, slash trigger at start/after-whitespace/inside-word/after-whitespace/out-of-range/caret-bounded, replacement at start/after-space/with-trailing-text/no-slash-append/ends-with-space/inside-word), `opencodeSearch.test.ts` (17 — agent filter by id/name/case/empty/no-match, `@` trigger variants, file/agent token builders, mention replacement variants), `composerContext.test.ts` (20 — isImageMime known/unknown/case, mime inference by type/extension/fallback, buildSendContext routing/drops/omits/combines, parse helpers), `composerPromptQueue.test.ts` (11 — enqueue/snapshot/mode/context, takeNextDeliverable/Steer ordering, remove/clear/unique-ids, defaultQueueMode), `promptHistory.test.ts` (20 — record/list/increment/empty/cap/remove/clear, frecency recent-vs-old + frequency + floor, up/down navigation including empty-list + clamp, parseHistoryFile valid/invalid/wrong-version/malformed-drop), and a new `M3 composer endpoints` block in `workspaceAgentBackend.test.ts` (8 — listCommands mapping/drop-empty/preserve-optional/error-degrade, findFiles mapping/forward-query/empty-query-skip/bare-array/transport-error-degrade, plus a sendPrompt context-forwarding test). Existing inline `RawOpencodeClient` stubs in `workspaceAgentBackend.test.ts` (4) and `.messages.test.ts` (1) extended with no-op `listCommands`/`findFiles` so they satisfy the widened interface; the shared `rawOpencodeClientStub.ts` test helper gained the two methods too. All 1473 TS tests pass (was 1377 — +96 net new, 0 new failures). svelte-check **0 errors** (62 warnings unchanged — all pre-existing in settings panels / unrelated components). Marked `execution-plan-m3.md` M3-T1..T6 DONE — M3 is complete.

## 2026-06-17 22:10

- **Phase 3.5 M2 — Session management & history:** Full OpenCode session lifecycle now flows through SpecOps (fork, undo/redo, share, summarize, rename, export, unified session list, session-level cost). All nine M2 tasks landed (T1–T9); see [execution-plan-m2.md](./ops/phase-3.5/execution-plan-m2.md).
- **Backend (M2-T1..T8):** Extended `WorkspaceAgentBackend` + `RawOpencodeClient` (`app/src/lib/ai/backends/workspaceAgentBackend.ts`) with the v2 SDK session endpoints: `getSessionDetails`, `listSessionDetails`, `updateSessionTitle`, `forkSession`, `revertSession`, `unrevertSession`, `shareSession`, `unshareSession`, `summarizeSession`, `listSessionChildren`. Added `WorkspaceAgentSessionDetails` (rich `Session` view: share URL, parent/fork lineage, revert preview `{messageId,partId,diff,snapshot}`, cost snapshot) + `mapSessionDetails` that unwraps `.data` and is tolerant of missing optional fields. `cursor-local` backend stubs throw `NotImplemented` for all new methods. New mappers: `opencodeSessionExport.ts` (transcript → Markdown with front-matter header + per-message role/timestamp + collapsible tool-call I/O blocks) and `opencodeSessionList.ts` (sort/filter/date-group/timestamp-format helpers for the unified session panel).
- **Store (M2-T1/T3/T5):** `AgentIndexEntry` gains `opencodeShareUrl` + `opencodeParentSessionId`; `chatPersistenceCodec` round-trips both (lenient validation, matching the existing opencode fields). `AgentSessionLinkPatch` carries share URL + parent. `chatStore.renameAgent(title)` updates title + bumps `lastUsedAt` (no-op on empty/duplicate). `chatStore.forkAgent({opencodeSessionId,opencodeParentSessionId,title?,modelId?,providerId?})` creates a fresh active non-draft agent tab linked to the child session, inheriting model/provider from the parent entry and deriving a `"Parent (fork)"` title when none is supplied. `clearAgentSessionLink` now also drops share + parent lineage.
- **Handlers (`appShellAgentHandlers.ts`):** `handleRenameAgent` (prompts via `entryNamePrompt`, calls `session.update`, then `renameAgent` — draft agents rename locally only), `handleForkAgent` (calls `session.fork`, creates child tab via `forkAgent`, opens + focuses it), `handleRevertSession`/`handleUnrevertSession` (confirm via the new `revertPreviewPrompt` runner before applying the destructive `session.revert`; redo calls `session.unrevert`), `handleShareAgent`/`handleUnshareAgent` (persists `opencodeShareUrl` on the entry + copies the URL via `navigator.clipboard` — the codebase convention), `handleSummarizeAgent` (calls `session.summarize` then re-hydrates so the summary lands in thread metadata), `handleExportAgent` (builds markdown via `buildSessionTranscriptMarkdown` + saves through the existing Tauri `saveFileAs` dialog), `handleOpenExternalSession` (opens any OpenCode session — including ones not created as SpecOps tabs — reusing an existing linked tab when present), `handleListWorkspaceSessions` (fetches `listSessionDetails` for the panel; errors degrade to `[]`).
- **UI:** New components — `RevertPreviewDialog.svelte` (modal confirm-before-revert with diff preview, registry-runner pattern mirroring `EntryNamePrompt`), `SessionSummary.svelte` (collapsible banner at the top of the chat rendering `metadata.summary`), `SessionListPanel.svelte` (modal overlay: search/sort/recently-updated grouping, per-row share/fork/open badges, quick-open any session). `ChatPanel.svelte` header gains a "Session" actions menu (Share/Unshare/Summarize/Export/Redo) + `fork`/`shared` status badges + passes per-message Fork/Undo actions down. `ChatMessageList.svelte` adds a hover-revealed per-message action toolbar (Fork / Undo) gated to workspace agents with linked sessions. `AgentsSidebar.svelte` context menu gains Rename / Copy share link / Export transcript (share/export hidden for draft agents) + a "Sessions" header button that opens the unified panel. `AgentSidebarRow` subtitles now append the cumulative session cost (M2-T8) via `deriveAgentSubtitleFromMessages` → `extractSessionTotals`. Wired end-to-end through `AppShell` props and `+page.svelte`.
- **Tests (M2-T9):** New test coverage across 4 files: `opencodeSessionExport.test.ts` (11 — header front-matter, per-message rendering, tool-call folding incl. failed-tool `(failed)` + error summary, empty-message skip, title newline escaping, filename slug fallbacks), `opencodeSessionList.test.ts` (13 — sort mutated-input safety, case-insensitive title/id filter, date-bucket placement incl. null-timestamp → older, timestamp formatting), `workspaceAgentBackend.test.ts` lifecycle block (13 — update/fork/revert/unrevert/share/unshare/summarize arg-forwarding + mapping, getSessionDetails mapping + notFound→null, listSessionDetails array mapping + non-array→[]), and `chatStore/agents.test.ts` rename/fork/link cases (title bump + lastUsedAt, empty-title rejection, unknown-id, no-op-on-duplicate, fork creates active child tab inheriting model/provider, fork derives `"Parent (fork)"` title, fork returns null without a workspace, share/parent link round-trip + clear). Also added `app/src/lib/test/rawOpencodeClientStub.ts` — a shared `RawOpencodeClient` no-op factory so the three existing test files that build client stubs (`workspaceAgentBackend.test.ts`, `.messages.test.ts`, `phase3M3.validation.test.ts`) don't drift out of sync as the `RawOpencodeClient` surface grows; all three refactored to use it. 1302 TS tests pass (was 1281 on the clean baseline; +21 net new, 0 new failures — the 11 pre-existing failures in `chatMarkdown`/`MarkdownRenderer`/`sessionManager` are unchanged). svelte-check **1 error** (down from 2 on baseline — the remaining `SettingsDialog.svelte` Snippet-type error is pre-existing and unrelated); 62 warnings unchanged.

## 2026-06-17 16:10

- **Phase 3.5 M1-T11 — Tests (close out M1):** Filled the test gap left by M1-T4 through M1-T10. Audited existing coverage first: part mapping (16 in `opencodeSessionMessages.test.ts`), stream normalization (37 in `workspaceAgentBackend.test.ts`), codec round-trip with all 8 part types + a malformed-parts drop case (in `chatPersistence.test.ts`), and the extractor helpers (`chatReasoning`/`chatSubtasks`/`chatSteps`/`chatAttachments`/`chatDiffs`) plus `chatMarkdown` were all already covered as each task landed. The actual gap was **component tests for the 8 new renderers** — none existed (the repo had no Svelte component-mount tests at all, only logic-module tests co-located with components). Added 64 new component tests across 8 files (8 each for `ReasoningBlock`/`ImageAttachment`, 13 for `SubtaskCard`, 9 each for `StepSeparator`/`InlineDiff`, 7 for `FileAttachmentChip`, 5 each for `MarkdownRenderer`/`SessionTotalBadge`). Coverage per component: rendered label/text/alt, status-icon and modifier-class variants, controlled expanded-state chevron + `aria-expanded` toggling, `onToggle` invocation on enabled headers (and *non*-invocation on disabled headers), `aria-controls`↔body-id wiring (ReasoningBlock), output-summary truncation + error-preferred-over-output (SubtaskCard), token `k`/`M` formatting + cost trailing-zero trimming + role=separator (StepSeparator), filename-extension / mime-subtype / full-mime badge fallback chain + download affordance (FileAttachmentChip), full open/close lifecycle for the click-to-zoom overlay — thumb-click opens, close-button / backdrop-click / Escape (via the `<svelte:window>` global listener) all close it, full-image click does *not* close (stopPropagation), Escape is a no-op while closed (ImageAttachment), short-hash truncation + singular/plural file count + disabled-header behaviour (InlineDiff), heading/code-block/emphasis/link rendering + script-strip after sanitization (MarkdownRenderer), compact token fields + full-breakdown hover title + cost-only aria-label (SessionTotalBadge). **New shared harness** `app/src/lib/components/_testComponentMount.ts` — a tiny Svelte 5 `mount`/`unmount` wrapper that mounts into a fresh `<div>`, registers auto-teardown via `afterEach`, and idempotently no-ops a manual `unmount()` so tests that re-mount across prop changes don't trigger `lifecycle_double_unmount`. The repo has no `@testing-library/svelte`; rather than add a dependency the harness uses Svelte 5's built-in client `mount`. **Config change in `app/vitest.config.ts`:** added `resolve.conditions: ["browser"]`. Without it, Svelte 5 resolves to its server entry (`index-server.js`) under jsdom and `mount(...)` throws `lifecycle_function_unavailable` — Vite's `DEFAULT_SERVER_CONDITIONS` filter out `browser` and the `@sveltejs/vite-plugin-svelte` only injects the `svelte` condition (not `browser`) for non-client environments. Forcing `browser` makes Svelte's `exports["."].browser` (`index-client.js`, which exports `mount`/`unmount`) win. This is safe: every other test imports logic modules and never touches Svelte's client/server split. Two ImageAttachment tests that mutate `zoomed` state then assert on the overlay DOM await Svelte's `tick()` between the action and the assertion because Svelte 5 batches DOM updates into a microtask. All 1332 TS tests pass (was 1268 — +64 new), svelte-check **0 errors** (the 59 warnings are pre-existing across `EntryNamePrompt.svelte`/`ImageAttachment.svelte`/settings panels). Marked `execution-plan-m1.md` M1-T11 DONE — M1 is now complete.

## 2026-06-17 15:40

- **Phase 3.5 M1-T10 — Markdown rendering for text parts:** Assistant (workspace-agent) messages now render as full GFM markdown with syntax-highlighted code blocks instead of plain text — previously multi-paragraph answers, lists, tables, headings, and code all collapsed into a single `white-space: pre-wrap` paragraph. Added new `app/src/lib/ai/chatMarkdown.ts` with `renderChatMarkdown(source, force?)` — a memoized (by source string, LRU-bounded at 128 entries) pipeline: `marked` v18 parses with GFM + `breaks` (single newlines → `<br>`) → a custom `code()` renderer feeds each fenced block through `highlight.js` (common-languages build: ~37 languages incl. ts/js/python/rust/go/bash/json/yaml/sql/html/css/…) with auto-detection when no fence language is given → `DOMPurify` v3 sanitizes the result (default allow-list keeps all markdown-emitted tags; strips `<script>`, inline event handlers, `javascript:` URLs, mXSS vectors; `ADD_ATTR: ["target","data-lang"]` permits link targets and our code-block language label). Each code block renders as `<pre class="chat-code"><code class="hljs language-X">…</code><span class="chat-code-lang" data-lang="X">X</span></pre>` — the language label floats top-right as a non-interactive uppercase badge. Returns `{ html, codeBlockCount }`. Also added `invalidateChatMarkdown(source?)` to drop a single entry or clear the cache. The task said to first check for existing markdown viewer code: `marked` v18 was already a dependency (used by `appShellDocumentView.ts`), but there was no shared sanitizer/highlighter and no chat-side renderer — so a new module was warranted. **Decision (confirmed with user):** install `dompurify` (3.4.11) and `highlight.js` (11.11.1) as runtime deps; `marked` reused. Added new `app/src/lib/components/MarkdownRenderer.svelte` — a thin wrapper that derives `renderChatMarkdown(source)` and injects via `{@html}` inside a `.chat-prose` div. Wired into `ChatMessageList.svelte` via a new `shouldRenderMarkdown(message, index)` gate: assistant messages render markdown once they stop streaming and aren't using structured-review sections (`shouldRenderStructuredSections`); user messages stay verbatim (so the user always sees exactly what they typed); system notices and streaming output keep the existing plain-text path. The prose container gets a `.chat-message-content-prose` class that resets `white-space: normal` (the base `.chat-message-content` is `pre-wrap`, which would break markdown block layout). Added new `app/src/lib/styles/chatProse.css` (imported globally via `+layout.svelte` since `{@html}` content can't receive Svelte-scoped styles) — typography for headings/lists/blockquotes/tables/links/hr, inline-code chips, and the `.chat-code` block; highlight.js token colors reuse the existing `--syntax-*` palette (`--syntax-keyword/string/comment/number/type/heading/markup/punctuation`) so prose code matches the editor in both light and dark themes rather than importing a fixed hljs stylesheet. **Test-environment change:** switched vitest from no explicit environment to `jsdom`. DOMPurify's mXSS detection (`_isUnsafeNode`) walks prototype-chain property descriptors via `lookupGetter(Node.prototype, 'nodeType')`; happy-dom exposes these as plain own-properties, so the getter lookup returns `undefined`, `isSupported` is `false`, and sanitization silently strips legal block elements (`<pre>`, `<h1>`, `<ul>`). jsdom's prototype chain is spec-compliant and DOMPurify works correctly. Guarded `snapshotThemeTokens` (`themeTokens.ts`) with a try/catch around `getComputedStyle(root)` since jsdom is stricter than happy-dom and throws on the plain-object mock used by `themes.test.ts`. Added 10 tests for `renderChatMarkdown` (headings/emphasis/GFM tables+task-lists/code-block wrapping/auto-detect/script-strip/javascript-URL-strip/inline-handler-strip/entity-escape-in-code/memoization/force-bypass/breaks). All 1268 TS tests pass; svelte-check clean for new/changed files (remaining 7 errors are pre-existing in ChatPanel.svelte). Marked `execution-plan-m1.md` M1-T10 DONE.

## 2026-06-17 13:54

- **Phase 3.5 M1-T9 — Render cost / token totals:** The chat panel header now shows a session running total (input/output/cache tokens + cumulative cost) next to the agent title, and the per-message totals footer (added in M1-T6) is now correct rather than double-counted. **Fixed a latent double-counting bug** in `extractMessageStepTotals` (`app/src/lib/ai/chatSteps.ts`): the trailing `cost` part that `session.messages` hydration appends is OpenCode's cumulative `AssistantMessage.info.cost` / `info.tokens` — i.e. the *sum of all step finishes within the message already*. The M1-T6 implementation summed both, inflating per-message (and therefore session) totals whenever a hydrated message carried both step finishes and the trailing cost part. The M1-T6 test even documented this as a known deferral ("M1-T9 owns per-message canonical totals"). Now `extractMessageStepTotals` prefers the canonical `cost` part when present (using the *last* one, since OpenCode appends a fresh cumulative snapshot on each session-messages refresh) and only falls back to summing step finishes in the live-streaming case where no `cost` part exists yet. **Added `extractSessionTotals(messages)`** to the same module — a pure, DOM-free helper that sums the (now-correct) per-message totals across all assistant messages (user/system messages contribute nothing), returning `{ cost, tokens, messageCount }` or `null` when no assistant message has any cost payload. `messageCount` lets the renderer distinguish "no data" from "zero cost". Because it reduces via `extractMessageStepTotals`, the per-message dedupe is inherited — a session total never double-counts a message's own step finishes against its cumulative cost part. **Extracted shared formatters** into new `app/src/lib/ai/chatTokenFormat.ts` (`formatTokenCount`, `formatCost`, `cacheTotal`) — previously these were copy-pasted across `ChatMessageList.svelte`, `ChatComposer.svelte`, and `StepSeparator.svelte`; `ChatMessageList.svelte` and `StepSeparator.svelte` now import the shared versions (behaviour identical — same k/M suffixing, same 4-decimal cost trimming, same cache read+write sum). `ChatComposer.svelte` was left untouched (its local copy is unrelated to this task's scope). **Added new `app/src/lib/components/SessionTotalBadge.svelte`** — a compact bordered badge (monospace `in/out/cache` token fields + cost) rendered in the chat panel header. A `title` attribute carries the full breakdown (input/output/cache-read/cache-write/reasoning/cost with raw counts) on hover so the visible label can stay compact. On narrow panels (`@container max-width: 520px`, matching the existing ChatPanel container query) the token fields collapse and only the cost shows — the tooltip still carries the full breakdown. **Wired into `ChatPanel.svelte`:** a `sessionTotals` derived resolves via `extractSessionTotals(messages)`; the header now has a `.chat-panel-header-actions` group (badge + delete button) so the title stays left-aligned and the actions cluster on the right. The badge only renders when `sessionTotals` is non-null — chat-http/debug threads (no cost payload on the wire) render no badge, so this is workspace-agent-only as expected. Added 9 new tests in `chatSteps.test.ts`: the cost-part-preferring fix replaces the old "folds in a trailing cost part" test with two new ones (canonical cost part preferred over step finishes; last cost part wins when several present), plus 7 `extractSessionTotals` tests (empty/null/no-assistant/single-message/multi-sum/no-double-count/cache-sum/skips-non-contributing). All 1258 TS tests pass; svelte-check clean for new/changed files (remaining 5 errors are pre-existing in ChatPanel.svelte/SettingsDialog.svelte). Marked `execution-plan-m1.md` M1-T9 DONE.

## 2026-06-17 13:35

- **Phase 3.5 M1-T8 — Render diff / snapshot parts:** Assistant messages now render each `diff` part (from M1-T1) as an inline, collapsible `InlineDiff` card — previously these parts were silently dropped from the UI. The OpenCode `snapshot` and `patch` parts are both normalized into a single SpecOps `ChatDiffPart` during `session.messages` hydration: `snapshot` → `{ type:"diff", snapshot }` (a checkpoint hash) and `patch` → `{ type:"diff", snapshot?, files }` (hash + changed file list). Important data-shape finding: **neither part carries the unified-diff `+`/`-` hunks** — the line-level diff lives behind the separate `session.diff` API (M5-T2). So the inline preview renders the metadata we *do* have (checkpoint hash + changed-file list) rather than a per-line diff viewer; the task spec's "mini unified diff viewer" was down-scoped to match the wire, with a note in the helper. The task also said to reuse existing diff-viewer code: `DiffPreviewPane.svelte` already imports the `diff` library (v9) for an unrelated editor-pane saved-vs-current view, but that component compares two full strings passed as props — the OpenCode snapshot/patch parts carry no comparable before/after content, so it could not be reused here (left untouched). Added new `app/src/lib/ai/chatDiffs.ts` with `extractMessageDiffs(message)` — a pure, DOM-free helper that pulls all `ChatDiffPart` entries from `message.parts` (kept separate rather than joined, since each diff part is its own checkpoint/patch), trims the `snapshot` hash and each file path, drops whitespace-only file entries, drops parts that carry neither a hash nor any files (nothing to render), and returns `{ id, snapshot?, files? }` (id falls back to `${messageId}:diff:${index}` where index is the position among all parts; omitted fields are absent rather than empty). Added `countMessageDiffs(message)` convenience (dropped parts don't count). The extractor is role-agnostic; role filtering stays the component's concern (mirrors reasoning/subtask/step). Added new `app/src/lib/components/InlineDiff.svelte` — an accent-bordered card with a header (Δ icon, "Checkpoint" label + short-sha `<code>` OR "Changed files" label when no hash, file count on the right, chevron) and a collapsible body listing the changed file paths as monospace `<code>` items (scroll-capped at 220px). The short-sha truncates to 7 chars (git convention). Expand state is controlled by the parent (`expanded` prop + `onToggle`); the header button is `disabled` (no chevron, `aria-expanded` undefined) when there are no files to expand. Body height animates via the same `grid-template-rows: 0fr → 1fr` technique as `ReasoningBlock`/`SubtaskCard` (respects `prefers-reduced-motion`). Wired into `ChatMessageList.svelte`: each assistant message resolves its diffs via `diffsFor` (assistant-gated), renders them in a `.chat-inline-diffs` stack between the file attachments and the totals footer, with per-diff expanded state in an `expandedDiffs` map (no global toggle — diffs are independent). Added 17 tests for `extractMessageDiffs`/`countMessageDiffs` (no-parts/no-diff/snapshot-only/files-only/snapshot+files/kept-separate/id-fallback/position-fallback/drop-empty/drop-whitespace/trim-snapshot+files/omit-absent-snapshot/omit-absent-files/role-not-gated; count zero/drop-doesnt-count/total). All 1249 TS tests pass; svelte-check clean for new/changed files (remaining 5 errors are pre-existing in ChatPanel.svelte). Marked `execution-plan-m1.md` M1-T8 DONE.

## 2026-06-17 13:15

- **Phase 3.5 M1-T7 — Render file attachments:** Messages now render `file` parts (from M1-T1) — previously these were silently dropped from the UI. Images render inline with click-to-zoom; other files render as downloadable chips. Added new `app/src/lib/ai/chatAttachments.ts` with `extractMessageAttachments(message)` — a pure, DOM-free helper that pulls all `ChatFilePart` entries from `message.parts`, splits them into `images` and `files` (by mime), and returns `{ id, mime, filename?, url, isImage }` per attachment (id falls back to `${message.id}:file:${fileIndex}` where the index counts only file parts, not all parts, so the fallback id is stable across non-file parts). Image classification uses a whitelist of known raster/vector image mimes (png/jpeg/gif/webp/svg+xml/bmp/icon/avif) plus a fallthrough for any `image/*` subtype (so unknown formats degrade gracefully — the `<img>` simply won't decode). Mime comparison is case-insensitive (normalized via `trim().toLowerCase()`). Parts with empty or whitespace-only `url`/`mime` are dropped; whitespace-only `filename` is omitted rather than rendered as spaces. The extractor does NOT gate on message role — unlike reasoning/subtask/step (assistant-only), file parts also arrive on user messages (pasted/uploaded attachments), so the component renders them on all roles. Also added `countMessageAttachments(message)` convenience. Added new `app/src/lib/components/ImageAttachment.svelte` — a `<figure>` with a thumbnail `<button>` (max 280×220, lazy-loaded, accent border on hover/focus) that opens a full-viewport overlay (`role="dialog"`, `aria-modal="true"`, blurred backdrop, close on click/Esc/✕ button, image stops click propagation so it isn't dismissed by panning). Caption shows the filename (when present) + a "Click to zoom" hint. Added new `app/src/lib/components/FileAttachmentChip.svelte` — a pill `<a download target=_blank>` (download icon + monospace filename + uppercase extension badge). Extension is derived from the filename extension, falling back to the mime subtype; the chip links directly to the `url` so the browser handles the download. Note: the task spec mentioned "size", but the OpenCode SDK `FilePart` and the SpecOps `ChatFilePart` carry no `size` field, so the chip renders filename + extension badge rather than a byte count (the data simply isn't on the wire). Wired into `ChatMessageList.svelte`: each message resolves its attachments via `attachmentsFor` (not role-gated), rendering images (`.chat-attachments-images`, flex-wrap row) and files (`.chat-attachments-files`, flex-wrap row) between the tool cards and the totals footer; adjacent attachment/tool regions share a single gap. Added 14 tests for `extractMessageAttachments`/`countMessageAttachments` (no-parts/no-file/image-classify/file-classify/unknown-image-subtype/svg/case-insensitive/arrival-order-split/empty-url-mime-drop/id-fallback-position/whitespace-filename-omit/role-not-gated; count zero/total). All 1232 TS tests pass; svelte-check clean for new/changed files (remaining 5 errors are pre-existing in ChatPanel.svelte/SettingsDialog.svelte). Marked `execution-plan-m1.md` M1-T7 DONE.

## 2026-06-16 23:40

- **Phase 3.5 M1-T6 — Render step boundaries with cost / tokens:** Assistant messages now render each agentic step (the `step` parts added in M1-T1) as a thin separator — previously these parts were silently dropped from the UI. Added new `app/src/lib/ai/chatSteps.ts` with two pure, DOM-free helpers: `extractMessageSteps(message)` collapses each `step` start/finish part pair into a single `MessageStepBoundary` (`{ id, stepNumber, status, cost?, tokens?, reason? }`) — a `start` with no matching `finish` is surfaced as `status: "running"`, and a `finish` with no token payload is surfaced as `status: "failed"` (matches the stream `step.failed` mapping which emits no finish part). Parts are paired by `part.index` (the OpenCode-assigned 0-based step counter), falling back to arrival position among step parts when `index` is missing so ordering stays stable; a re-emitted `start` for the same index replaces the earlier one (latest wins). Boundaries are sorted by step number so a still-running step renders after completed ones. Added `extractMessageStepTotals(message)` which sums `cost` and `tokens` (input/output/reasoning/cache.read/cache.write) across step finishes and any trailing `cost` part (the session-messages hydration appends one from `info.cost`/`info.tokens` so totals are present even without a step finish) — returns `null` when nothing contributes so callers render no footer. Both helpers are role-agnostic; role filtering stays the component's concern (mirrors reasoning/subtask helpers). Added new `app/src/lib/components/StepSeparator.svelte` — a status-colored thin separator (rule + centered label + rule): "Step N", an animated pulsing dot for running steps (accent-colored rules), "✗ failed" label + red rules for failed steps, a compact monospace token breakdown (`in/out/cache` — cache is read+write summed, large counts shortened to `1.2k`/`3M`), and cost (`$0.012`, trailing zeros trimmed). Respects `prefers-reduced-motion`. Wired into `ChatMessageList.svelte`: each assistant message resolves its boundaries via `stepsFor` (assistant-gated) and renders a `.chat-step-separators` stack above the reasoning/subtask/content; a `.chat-message-totals` footer (right-aligned, dashed top border) shows the running `in/out/cache` token total + cumulative cost from `stepTotalsFor`. Added 19 tests for `extractMessageSteps`/`extractMessageStepTotals` (no-parts/no-step/start+finish-pair/open-start-running/multi-ordered/failed-no-tokens/id-fallback/arrival-fallback-index/re-emitted-start-latest-wins/running-after-completed/role-not-gated/optional-fields-omitted; totals null/no-contribute/sum-multi/cost-part-fold/lone-cost/non-finite-ignored/cache-accumulated). All 1218 TS tests pass; svelte-check clean for new/changed files (remaining 5 errors are pre-existing in ChatPanel.svelte/SettingsDialog.svelte). Marked `execution-plan-m1.md` M1-T6 DONE.

## 2026-06-16 23:10

- **Phase 3.5 M1-T5 — Render subtask (subagent) parts:** Assistant messages now render each `subtask` part (from M1-T1) as an inline, collapsible `SubtaskCard` — previously these parts were silently dropped from the UI. Added new `app/src/lib/ai/chatSubtasks.ts` with `extractMessageSubtasks(message)` — a pure, DOM-free helper that pulls all `ChatSubtaskPart` entries from `message.parts` (kept separate rather than joined, since each subtask has its own agent/status/output), drops parts with whitespace-only agent names, and returns `{ id, agent, description?, prompt?, status, output?, error? }` (id falls back to `${messageId}:subtask:${index}` when no part id exists). Unlike `extractMessageReasoning`, the extractor itself does not gate on message role — role filtering stays the component's concern, matching the reasoning helper's contract. Added new `app/src/lib/components/SubtaskCard.svelte` — a status-colored card (running=accent border + ⏳, completed=green ✓, failed=red ✗) with a header row (status icon, monospace agent name, status label, one-line output summary, chevron) and an expandable body (description, prompt, and output/error sections in scrollable `<pre>` blocks, error shown in red and preferred over output when both exist). Expand state is controlled by the parent (`expanded` prop + `onToggle`); the header button is `disabled` (no chevron, `aria-expanded` undefined) when there are no expandable details. Body height animates via the same `grid-template-rows: 0fr → 1fr` technique as `ReasoningBlock` (respects `prefers-reduced-motion`). Wired into `ChatMessageList.svelte`: each assistant message resolves its subtasks via `subtasksFor` (which filters to assistant role), renders them in a `.chat-subtask-cards` stack between the reasoning block and the message content, with per-subtask expanded state in an `expandedSubtasks` map (no global toggle — subtasks are independent). Added 11 tests for `extractMessageSubtasks` (no-parts/no-subtask/single/multi-kept-separate/output+error/id-fallback/index-based-fallback-id/whitespace-agent-drop/no-details-kept/role-not-gated/optional-fields-omitted). Note: the task spec mentioned a "model" field, but the OpenCode SDK `SubtaskPart` carries only `agent`/`description`/`prompt` (no model), and the SpecOps `ChatSubtaskPart` / `subtask.started` stream event likewise have no model — so the card renders the agent name instead, matching the available data. All 1199 TS tests pass; svelte-check clean for new/changed files (remaining 5 errors are pre-existing in ChatPanel.svelte/EntryNamePrompt.svelte). Marked `execution-plan-m1.md` M1-T5 DONE.

## 2026-06-16 16:50

- **Phase 3.5 M1-T4 — Render reasoning blocks:** Assistant messages now render the model's thinking (the `reasoning` parts added in M1-T1) as a collapsible, dimmed, italic panel above the message content — previously reasoning was silently dropped from the UI. Added new `app/src/lib/ai/chatReasoning.ts` with `extractMessageReasoning(message)` — a pure, DOM-free helper that pulls all `ChatReasoningPart` entries from `message.parts`, joins their text (blank-line separated, in arrival order), drops whitespace-only parts, and returns `{ id, text }` (id falls back to the message id when no part ids exist). Returns `null` for messages with no parts / no reasoning parts so callers render nothing. Added new `app/src/lib/components/ReasoningBlock.svelte` — a collapsible block with a clickable header ("Reasoning" + chevron + optional "thinking…" status while streaming), dimmed/italic body text, and a CSS `grid-template-rows: 0fr → 1fr` height animation that avoids measuring content (respects `prefers-reduced-motion`). The expand state is controlled by the parent (`expanded` prop + `onToggle` callback) so a global toggle can override per-message state. Wired into `ChatMessageList.svelte`: each assistant message resolves its reasoning via `extractMessageReasoning` (memoized per-render with `{@const}`), renders a `<ReasoningBlock>` when present, and a "Show all reasoning" / "Hide all reasoning" toolbar button (only shown when at least one visible message carries reasoning) toggles `showAllReasoning` — per-message `expandedReasoning` map lets individual messages opt out even when the global toggle is on. Default state is collapsed (reasoning on demand). Added 9 tests for `extractMessageReasoning` (no-parts/no-reasoning/single-part/multi-part-join/id-fallback/empty-id-skip/all-whitespace/mixed-drop/user-role). All 1188 TS tests pass; svelte-check clean for new/changed files (remaining 5 errors are pre-existing in ChatPanel.svelte). Marked `execution-plan-m1.md` M1-T4 DONE.

## 2026-06-16 14:45

- **Phase 3.5 M1-T3 — Hydrate session history from `session.messages`:** Made the OpenCode `session.messages` payload the display source of truth for workspace agent tabs (per Q3 decision); the local thread snapshot is now an offline cache/fallback. Added `listMessages` to the `WorkspaceAgentBackend` interface, `RawOpencodeClient`, the SDK client (`sdk.session.messages`), the cursor-local stub, and the opencode backend (with `notFound` → `[]` tolerance and `unwrapList` normalization at the backend level so the contract is enforced regardless of client impl). Added new `ai/backends/opencodeSessionMessages.ts` with `mapSessionMessageEntry` / `mapSessionMessages` — maps OpenCode `{ info, parts }` entries to SpecOps `ChatMessage[]` with full structured parts (text, reasoning, subtask, step-start/step-finish with sequential indices, file, snapshot→diff, patch→diff, compaction) plus a derived flat `content` fallback (flattened text parts, or assistant `summary.body` when no text parts). Tool parts are extracted into `toolCalls` (mapping `completed`→success, `error`→failure, else pending). Assistant messages also emit a trailing `cost` part from `info.cost`/`info.tokens` so per-message cost rendering (M1-T9) has data even without a step-finish part. Unknown OpenCode roles (e.g. `synthetic`) are surfaced as `system` markers. Malformed entries/parts are dropped rather than failing hydration, matching codec behaviour. Added `setThreadMessages` to the `threadMessages` store slice to replace an agent's full message list (updates `metadata.updatedAt`). Added new `services/workspaceAgentHydration.ts` (`hydrateWorkspaceAgentMessages`) which fetches `session.messages` for each agent with a linked `opencodeSessionId` and replaces its thread — failures (`serverUnavailable`/`transportError`/`authFailure`/`notFound`) are non-fatal so the local snapshot stays in place. Wired `restoreWorkspaceAgentSession` (in `services/appShellAgentHandlers.ts`) to call hydration after the agent index is restored; hydration itself is wrapped in a `.catch(() => {})` so it never blocks workspace open. Updated existing test mocks (`workspaceAgentBackend.test.ts`, `phase3M3.validation.test.ts`, `appShellAgentHandlers.test.ts`) for the new `listMessages`/`setThreadMessages` members. Added 31 new tests across 5 files: `opencodeSessionMessages.test.ts` (16 — mapper coverage for all part types, role/content fallbacks, malformed drops), `workspaceAgentBackend.messages.test.ts` (5 — listMessages unwrap/notFound/rethrow), `threadMessages.test.ts` (+2 — setThreadMessages replace + missing-thread), `workspaceAgentHydration.test.ts` (6 — per-agent fetch, empty-skip, non-fatal errors, malformed drops), `appShellAgentHandlers.test.ts` (+2 — restore triggers hydration, non-fatal on failure). All 1179 TS tests pass; svelte-check clean for new/changed files (remaining 5 errors are pre-existing in ChatPanel.svelte/settingsStore.test.ts). Marked `execution-plan-m1.md` M1-T3 DONE.

## 2026-06-15 23:35

- **Phase 3.5 M1-T1 — Extend `ChatMessage` domain for parts:** Added structured `ChatMessagePart` types to `app/src/lib/domain/chat.ts`: `ChatTextPart`, `ChatReasoningPart`, `ChatSubtaskPart` (status: running/completed/failed), `ChatStepPart` (phase: start/finish, cost, tokens), `ChatFilePart`, `ChatDiffPart`, `ChatCompactionPart`, `ChatCostPart`, plus a shared `ChatTokenUsage` shape (`input`/`output`/`reasoning`/`cache.{read,write}`). Added optional `parts?: ChatMessagePart[]` to `ChatMessage` — flat `content` is retained as fallback/summary. Exported all new types from `domain/contracts.ts`. Updated `services/chatPersistenceCodec.ts` with `parseMessagePart`/`parseParts`/`parseTokenUsage` validators (invalid parts are dropped to `undefined`, matching existing `toolCalls` lenient pattern; version stays at 1 — additive optional field). Added `updateMessageParts` method to `state/chatStore/threadMessages.ts` slice. Added codec round-trip tests (all 8 part types), a "drops malformed parts" test, and two `updateMessageParts` store tests.

- **Phase 3.5 M1-T2 — Extend stream normalization for reasoning + subtask + step:** Added 6 new variants to `WorkspaceAgentStreamEvent` in `ai/backends/workspaceAgentBackend.ts`: `reasoning.delta` (reasoningId + delta), `reasoning.ended` (reasoningId + text), `subtask.started` (subtaskId/agent/description/prompt), `step.started` (stepId/agent/modelId/providerId), `step.finished` (stepId/reason/cost/tokens), `step.failed` (stepId/message), plus `WorkspaceAgentTokenUsage` interface. Extended `mapStreamFrame`: maps `session.next.reasoning.delta`/`.ended` → reasoning events; `session.next.step.started`/`.ended`/`.failed` → step events (note: SDK event is `.ended`, mapped to `step.finished`); `message.part.updated` with `part.type === "subtask"` → `subtask.started` (the SDK has no `session.next.subtask.*` events — subtask data arrives via `message.part.updated`). Added `readNumber`/`readTokenUsage` helpers. Cleaned up the error handler: `session.next.step.failed` now maps to `step.failed` (was previously mapped to `run.failed`); `session.error` extracts message from error object body (v2 shape). Added 7 stream normalization tests covering reasoning delta/ended, empty-delta skip, step started/ended/failed, subtask from part-updated, and non-subtask part filtering. All 1148 TS tests pass.

## 2026-06-15 23:15

- **Phase 3.5 M0 — SDK migration:** Replaced the hand-rolled fetch-based OpenCode HTTP client with the official `@opencode-ai/sdk` v2 client (`createOpencodeClient` from `@opencode-ai/sdk/v2`). Added the SDK to `app/package.json`. Replaced `createHttpOpencodeClient` with `createSdkOpencodeClient` in `app/src/lib/ai/backends/workspaceAgentBackend.ts` — it instantiates an SDK client with `baseUrl`, `directory`, `Authorization` header, and `throwOnError: true`, then delegates each `RawOpencodeClient` method to the matching SDK API (`session.create/get/list/delete/prompt/abort`, `permission.reply`, `question.reply/reject`, `event.subscribe`, `config.providers`, `provider.list`, `app.agents`). The `RawOpencodeClient` interface and the public `WorkspaceAgentBackend` interface are unchanged so the rest of the backend didn't need edits (M1–M5 will extend the interface progressively). Added `mapSdkError` that extracts status from `error.cause` (populated by the SDK's `wrapClientError` interceptor) and routes through the existing `mapHttpError` codes (`authFailure`/`notFound`/`invalidDirectory`/`serverUnavailable`/`transportError`); network failures with no status map to `serverUnavailable`. Removed the raw HTTP code: `parseSse`, `request`, `requestWithFallback`, `addQueryParams`, `toHttpError`, `authHeaders`. Updated existing transport-mocked tests to return real `Response` objects (SDK requires them) and to read request metadata off the `Request` object the SDK passes to `fetch` (instead of the previous `fetch(url, init)` signature). Added 7 new "SDK transport" tests covering response-data unwrap, `x-opencode-directory` header on POSTs, JSON error-body extraction (`{name, message}`), network-failure mapping, `session.prompt` body shape (`parts: [{type:"text",text}]` + `model: {providerID, modelID}`), missing-model handling, and end-to-end SSE streaming through `event.subscribe`. The foundation for M1–M5 (session messages/fork/revert/share/diff/todo, config, mcp, command, etc.) is in place — those methods will be added to `WorkspaceAgentBackend` progressively as each milestone lands. All 1136 TS tests pass. Marked `execution-plan-m0.md` DONE.

## 2026-06-15 13:30

- **Phase 3.5 decisions and execution plan split:** Applied recommended answers in `specs/ops/phase-3.5/questions.md` for Q1–Q7 and Q10–Q16 (Q8/Q9 kept custom: existing themes only; sounds/notifications deferred to backlog). Renamed SDK milestone M7 → **M0** (implement first). Split monolithic `execution-plan.md` into index + seven milestone docs (`execution-plan-m0.md` … `execution-plan-m6.md`). Updated `phase-3.5.md` prioritization, exit criteria, and M6 scope. Added deferred items (terminal, sounds, OS notifications, theme library) to `specs/backlog.md`.

## 2026-06-14 15:24

- **Phase 3.5 spec — OpenCode desktop parity:** Created `specs/ops/phase-3.5/` with a gap analysis comparing SpecOps workspace agents to OpenCode Desktop/Web app across message rendering, session management, composer, configuration management, workspace UX, and appearance. Identified that SpecOps currently uses ~12 raw HTTP endpoints out of ~80+ available SDK methods, and is missing reasoning/subtask/step/diff/attachment rendering, session fork/undo/share, slash commands, @ mentions, MCP/provider/agent/permission config management, terminal, diff viewer, TODO panel, and themes. Authored four documents: `phase-3.5.md` (spec with 7 work streams M1–M7), `gap-analysis.md` (feature-by-feature comparison tables), `execution-plan.md` (milestone tasks with file-level guidance), and `questions.md` (16 numbered questions with recommended answers). No code changes.

## 2026-06-14 14:50

- **Isolate workspace agent metadata and preflight from Chat HTTP (phase 3 M4 Task 5):** Made `ChatThreadMetadata.provider` optional; `createThreadMetadata` is now scope-aware — workspace (`ws-*`) threads omit `provider` and `connectionId`, storing OpenCode-only selection (`opencodeAgentId`, `opencodeProviderId`, `selectedModelId`). Added `WorkspaceReadinessChecker` interface and `workspaceReadinessCheckerRef` to the chat store access slice — `checkActiveWorkspaceCapabilities` short-circuits to the readiness checker (validates OpenCode enabled + health + catalog readiness) when a workspace thread has no HTTP provider metadata, bypassing the HTTP capability checker entirely. Bootstrap registers a concrete readiness checker wired to `appState` opencode settings/health and `opencodeCatalog` readiness. `composerSelectionActions.selectModel` for workspace context updates `selectedModelId` directly via `updateThreadMetadata` instead of going through `switchThreadModel` (which validates against HTTP catalogs). `ensureWorkspaceAgentSessionId` uses thread `opencodeProviderId` instead of hardcoded `"opencode"`, and `backend.send` passes `agent` and `provider` fields to the OpenCode prompt API. `ChatPanel.svelte` skips HTTP/debug/model blocked state computation for workspace context. Updated `WorkspaceAgentSendRequest` and `RawOpencodeClient.sendPrompt` to accept `agent` and `provider`. Updated existing tests to reflect workspace metadata isolation; added `phase3M4Task5.validation.test.ts` (9 tests). All 1129 TS tests pass.

## 2026-06-14 14:30

- **Dedicated workspace agent composer (phase 3 M4 Task 4):** Workspace agent composer now renders OpenCode-only pickers (agent/mode from `opencodeCatalog.agents`, provider from `opencodeCatalog.providers`, model from `opencodeCatalog.models`) via new `WorkspaceCatalogPicker.svelte` — `ChatComposer.svelte` branches on `chatContextKind === "workspace"` to avoid rendering `ChatConnectionPicker` or `ChatModePicker` backed by HTTP/`chatModesSettings`. `listSelectableChatConnections` is no longer called for workspace context (early-returns `[]`). Connection/mode fallback effects are skipped for workspace; model fallback uses `opencodeCatalog` models directly. Empty/loading/error states reference **Settings → Workspaces → OpenCode** and **Refresh model list**. Added `opencodeAgentId` and `opencodeProviderId` fields to `ChatThreadMetadata`, thread metadata patch types, and persistence codec. `ChatPanel.svelte` passes the new fields from thread metadata to the composer. Updated workspace empty hint and README to align with OpenCode agent/provider/model picker. Added tests for metadata roundtrip, codec persistence, and workspace catalog separation. All 1119 TS tests pass.

## 2026-06-14 14:15

- **OpenCode URL health checks, auth, and port-conflict reuse (phase 3 M4 Task 3):** Fixed stuck **Check connection** button — `checkOpencodeConnection` now calls `requestOpencodeHealthRefresh` directly (not just setting `checking` and relying on reactive re-trigger). Extracted shared `probeUrlHealth` helper with 10s `AbortController` timeout (aligned with sidecar `HEALTH_TIMEOUT`), HTTP basic auth (`Authorization: Basic base64(opencode:password)`) when server password is configured, and 401 → degraded with recovery hint. Added `serverPassword` field to `SyncOpencodeSidecarEffectInput` and `requestOpencodeHealthRefresh` input; auto-loads from `providerSecretsStore` when not provided. `createHttpOpencodeClient` now accepts and sends `serverPassword` as auth header on all API calls and SSE streams. Fixed Tauri CSP — added `connect-src` allowing `http://127.0.0.1:*` and `http://localhost:*` so frontend health probes reach localhost OpenCode servers. Sidecar port conflict: `spawn_sidecar` now probes the health endpoint before returning `PortInUse` — if a healthy OpenCode server is found, the error message guides the user to URL mode; if auth-required (401/403), it hints to set Server password. Added `probe_health_detailed` (Rust) returning `Healthy`/`AuthRequired`/`NotResponsive`. Added 12 new TS tests (probe timeout, auth header, 401 handling, fresh re-probe) and 2 new Rust tests (dead-port probe, port-in-use message). All 1109 TS + 12 Rust tests pass.

## 2026-06-14 13:35

- **Sidecar reuse across workspace switches (phase 3 M4 Task 1):** Removed directory equality from `should_reuse_sidecar` in `opencode_sidecar.rs` — a healthy running sidecar process is now reused regardless of which workspace folder is active, since `opencode serve` is directory-agnostic and `directory` is passed per HTTP request. When reusing, `start_or_attach` updates `inner.directory` to the requested workspace for diagnostics/status instead of stopping and respawning. Updated Rust unit tests: replaced `should_not_reuse_when_directory_differs` with `should_reuse_when_directory_differs_but_healthy`, added `should_not_reuse_when_child_dead`. All 10 Rust sidecar tests pass.
- **Sidecar deferred to workspace lifecycle (phase 3 M4 Task 2):** Verified lifecycle gate (`workspaceLifecycle.ts`) prevents sidecar attach on cold launch / passive session restore — `syncOpencodeSidecarEffect` early-returns when `workspaceLifecycleActive` is false; `restoreWorkspaceAgentSession` is called with `skipOpencodeReconcile: true` at startup; `markWorkspaceLifecycleActive()` fires on workspace add and activity-rail context switch. Added dedicated `workspaceLifecycle.test.ts` (4 tests covering inactive default, activation, idempotency, and reset). All 1097 TS tests pass.

## 2026-06-13 21:00

- **Workspace vs Chat composer separation (phase 3 M4 Tasks 4–5):** Added Tasks 4–5 to `execution-plan-m4.md` — workspace agents get an OpenCode-only composer (agents/plan-build, OpenCode providers, OpenCode models); Chat HTTP keeps its own settings/modes/providers/models; lanes share only internal primitives. Renamed milestone to cover sidecar lifecycle and workspace agent UX; added decision L5.

## 2026-06-13 20:00

- **OpenCode connection reliability (phase 3 M4 Task 3):** Added Task 3 to `execution-plan-m4.md` — fix stuck **Check connection** in URL mode, add health-probe timeout and HTTP basic auth for server password, resolve Tauri CSP/localhost fetch, and handle port-4096 conflicts when another OpenCode server (e.g. VS Code Kilo) is already running.

## 2026-06-13 19:15

- **Safe app launch & session fixes:** Startup phases in `startAppShellRuntime` are isolated with per-phase logging; fs scope errors (e.g. dotfiles like `.gitignore`) remove the inaccessible tab and persist immediately instead of aborting launch. Closed tabs flush session snapshot on close and on `pagehide`/`beforeunload` (fixes restored tabs after quick close). OpenCode sidecar attach is deferred until workspace lifecycle events (not passive session restore on launch); added Task 2 to `execution-plan-m4.md`. Default **Can open logs panel** is now enabled.

## 2026-06-13 18:30

- **OpenCode sidecar lifecycle plan (phase 3 M4):** Added `specs/ops/phase-3/execution-plan-m4.md` — post-MVP follow-up to keep the OpenCode sidecar running across workspace switches (reuse healthy process; scope requests via existing `directory` query param) instead of stop/restart on every active workspace change.

## 2026-06-13 16:00

- **OpenCode settings location:** Moved OpenCode workspace-agent settings from **Chats → Providers** into a dedicated **Workspaces → OpenCode** settings tab (`OpenCodeSettingsPanel.svelte`). **Chats → Providers** is HTTP-only again. Updated README, `docs/providers.md`, `docs/architecture.md`, and in-app error copy to match the new navigation.

## 2026-06-13 14:50

- **Tauri fileAssociations schema:** Restored required `ext: ["*"]` in `tauri.conf.json` alongside existing macOS `contentTypes` entries so `tauri dev` / bundle config validation passes (Tauri 2 requires `ext`; broad dock drops still use `LSItemContentTypes`).

## 2026-06-12 15:00

- **macOS integrated title bar (Task 3):** Configured Tauri window with `titleBarStyle: Overlay`, `hiddenTitle: true`, and `trafficLightPosition` for native macOS traffic-light controls (close/minimize/zoom) embedded in a theme-matched top strip. Added `core:window:allow-start-dragging` capability. Created `TitleBar.svelte` (macOS-only, 32px drag region) and integrated it into `AppShell.svelte` as the first grid row. Shell grid updated from 2-row to 3-row layout. Windows/Linux builds unaffected.
- **Custom Select component (Task 4):** Added `Select.svelte` — a custom dropdown (not a styled native `<select>`) with trigger button matching existing toolbar styles, popover panel styled like context menus, full keyboard navigation (ArrowUp/Down, Enter, Escape), and ARIA attributes (`aria-expanded`, `role="listbox"`/`role="option"`). Migrated all native `<select>` usages: `ChatModePicker`, `ChatConnectionPicker` (connection and model pickers), `ConnectionsSettingsPanel` (default model), and `ProviderModelCatalogPanel` (default model). Removed dead CSS for migrated native selects.

## 2026-06-11 14:30

- **Logs panel settings gate:** Added `logSettings.canOpenLogsPanel` (default `false`) in Settings → Logs. When disabled, the status bar no longer toggles the bottom logs panel (non-interactive, no hover), and an open panel is force-closed when the setting is turned off.

## 2026-06-11 12:00

- **macOS dock drop for hidden files:** Updated `tauri.conf.json` `fileAssociations` to declare broad `LSItemContentTypes` (`public.item`, `public.content`, `public.data`, etc.) instead of ineffective `ext: ["*"]` / `mimeType: "*/*"`. Dock icon drops for dotfiles (e.g. `.gitignore`) now reach `RunEvent::Opened`; window drag-and-drop was already unaffected.

## 2026-06-10 23:55

- **OpenCode opt-in gating (phase 3 M3.5):** Implemented `opencode.enabled` boolean setting (default `true`) allowing users to disable OpenCode for workspace agents and use workspace folders as plain editors. Added `enabled` field to `OpencodeSettings` in `domain/settings.ts` with normalization (missing/invalid → `true`) in `opencodeSettings.ts`. Exported `isOpencodeEnabled()` helper. Gated `syncOpencodeSidecarEffect`, `requestOpencodeHealthRefresh`, `syncOpencodeToggleEffect` (new — calls `stopOpencodeSidecar` on toggle off), `refreshOpencodeCatalog`, and `restoreWorkspaceAgentSession` to early-return/reset when disabled. Added `isWorkspaceSendBlockedWhenOpencodeDisabled` to block workspace sends with clear recovery message (`OPENCODE_DISABLED_MESSAGE`) in `sendChatMessage.ts` and `retryChatTurn.ts`. Hidden agents sidebar for workspace contexts when disabled in `+page.svelte`; skipped catalog `$effect` in `ChatPanel.svelte`. Added "Use OpenCode for workspace agents" toggle in `ConnectionsSettingsPanel.svelte` with collapsed transport/health/controls when off. Updated README to note sidecar only starts when enabled. Added 6 send-pipeline gating tests, 7 sidecar effect tests (disabled/stop/health reset), updated existing tests. All 1088 tests pass, 0 typecheck errors. Marked all tasks `[DONE]` in `execution-plan-m3-5.md`.

## 2026-06-10 17:30

- **OpenCode opt-in gating plan (phase 3 M3.5):** Added `specs/ops/phase-3/execution-plan-m3-5.md` — post-MVP follow-up to add `opencode.enabled` (“Use OpenCode for workspace agents”), gate sidecar/catalog/session lifecycle, block workspace sends when off, hide workspace agent affordances when disabled, settings UI toggle, and tests/docs. Linked from `phase-3.md` execution chain and non-goals.

## 2026-06-10 17:00

- **README:** Added “Workspace agents (OpenCode)” section — sidecar vs URL mode, quick start, OpenRouter and GLM Coding Plan (Z.AI) provider setup via OpenCode, troubleshooting, and distinction from Chat HTTP connections. Updated “What works today” and AI roadmap status for phase 3 completion.

## 2026-06-10 16:15

- **Regression and validation sweep + phase-3 closure (phase 3 M3 tasks 4–5):** Created `phase3M3.validation.test.ts` with 33 tests covering workspace HTTP cutover regression gate: workspace sends route exclusively through OpenCode backend (never HTTP ChatProvider), chat-http sends never invoke workspace backend, `shouldUseWorkspaceAgentBackend` routing invariants, event normalization contract alignment (v2 SDK events → contract names: `message.delta`, `tool.started`/`tool.completed`, `permission.requested`, `question.requested`, `run.failed`), session restore reconciliation (stale mapping detection, valid mapping preservation, session-scoped mapping without HTTP run-id fields), permission/question/tool flows end-to-end, workspace cancellation with `abortSession`, backend error mapping (auth failure, server unavailable). Chat-http non-regression coverage: SSE streaming, cancellation with abort signal, retry after failure. All 1071 tests pass, 0 typecheck errors. Marked phase-3 exit criteria complete in `phase-3.md` (status: complete). Marked tasks 4–5 `[DONE]` in `execution-plan-m3.md`. Added phase-5 handoff notes covering cursor-local backend stub, routing extension point, session mapping reuse, and contract freeze scoping.

## 2026-06-10 16:00

- **Breaking-change docs and user-facing notes (phase 3 M3 task 3):** Updated `docs/providers.md` opening paragraph to clarify HTTP provider registry applies to Chat context only — workspace uses OpenCode backend. Updated `docs/architecture.md` send pipeline and access preflight descriptions to distinguish Chat vs Workspace validation paths. Updated `chatErrorCopy.ts` recovery hints to remove "Choose HTTP" language from provider-agnostic error copy (`PROVIDER_UNAVAILABLE_RECOVERY`, `PROVIDER_UNSUPPORTED_ACCESS_RECOVERY`, `PROVIDER_NOT_REGISTERED_MESSAGE`, `PROVIDER_NOT_REGISTERED_RECOVERY`). Updated `selection.ts` doc comment to clarify default provider precedence is for Chat context only. Updated `ConnectionsSettingsPanel.svelte` Providers section note to specify "Chat context", empty state copy to say "Chat context" instead of "HTTP chat", and OpenCode section note to clarify workspace agents use OpenCode backend. Added breaking-change note to `phase-3.md` (E2A): legacy workspace HTTP thread JSON is not imported or migrated to OpenCode sessions. Marked Task 3 `[DONE]` in `execution-plan-m3.md`.

## 2026-06-10 15:18

- **Remove stale workspace HTTP branches and dead code (phase 3 M3 task 2):** Removed dead `validateWorkspaceAgentBackendSend()` function (never called after Task 1). Removed dead workspace access-preflight branch from `validateProviderSend()` (unreachable since workspace sends route through `validateOpencodeBackendSend`). Removed dead workspace-HTTP guard block and `logWorkspaceHttpProviderGuard` diagnostic from `executeProviderTurn()`/`chatDiagnostics.ts` (unreachable after Task 1 cutover). Updated HTTP provider capability message from "ready for workspace chat" to "ready for chat". Removed stale test "keeps workspace HTTP chat working" that tested dead workspace-HTTP path. Updated phase 2 validation test comments to reference OpenCode instead of HTTP for workspace. Updated workspace empty-hint text in `ChatPanel.svelte` and `ChatMessageList.svelte` to reflect OpenCode-first workspace runtime. Removed deprecated `resolveWorkspaceRoot` wrapper, migrating all callers to `resolveChatScopeKey`. Updated affected tests to use ws-* contexts where needed. `chat-http` send behavior completely unchanged. All 1038 tests pass, 0 typecheck errors.

## 2026-06-10 14:55

- **Workspace send-path cutover to OpenCode only (phase 3 M3 task 1):** Removed workspace (`ws-*`) context coupling to HTTP `ChatProvider` validation. Added `validateOpencodeBackendSend()` in `chatSendPipeline.ts` that checks filesystem access via `ensureWorkspaceReadAccess` and resolves model from OpenCode catalog or thread metadata — entirely independent of HTTP provider config/capability checks. Workspace sends now bypass `validateProviderSend()` (which validates HTTP API keys, provider capabilities, and model catalogs) and go directly through `validateOpencodeBackendSend()` → `executeWorkspaceAgentBackendTurn()`. Applied same cutover to `retryChatTurn.ts`. Added guard assertion in `executeProviderTurn()`: if a ws-* context somehow reaches the HTTP provider path, logs `logWorkspaceHttpProviderGuard` diagnostic and returns error. Added `logWorkspaceHttpProviderGuard` to `chatDiagnostics.ts`. Made `provider` and `accessStatus` optional in `executeProviderTurn`/`executeWorkspaceAgentBackendTurn` params since workspace sends don't need them. Added test verifying workspace sends succeed even when HTTP provider is unconfigured. Updated workspace send model assertion (model now resolved from OpenCode catalog/metadata instead of HTTP provider catalog). `chat-http` send behavior completely unchanged. All 1039 tests pass, 0 typecheck errors.

## 2026-06-10 14:40

- **Milestone 2 tests and verification (phase 3 M2 task 6):** Added comprehensive test coverage locking MVP interaction flows for workspace OpenCode runtime. Created `chatSendPipeline.test.ts` (13 tests) covering workspace streaming delta rendering interleaved with tool events, tool progress tracking during streaming, `run.failed` error handling, multiple tool calls with mixed success/failure, `message.completed` event replacing accumulated deltas, and tool call state preservation after cancellation. Added 6 edge case tests to `toolCallReducer.test.ts` covering failure lifecycle, progress on terminal state, multiple rapid progress updates, triple duplicate idempotency, out-of-order progress before start, and null callId consistency across all reducer functions. Added 5 stream normalization tests to `workspaceAgentBackend.test.ts` covering tool failure event normalization, `message.completed` from `text.ended` SDK event, malformed frame skipping, empty delta filtering, and concurrent tool calls with interleaved dedup. Added 8 workspace model selection tests to `selection.test.ts` covering `resolveWorkspaceModelId` (preferred model, stale fallback, null/empty/whitespace handling) and `listSelectableWorkspaceModels`. Total test count increased from 1007 to 1038. All tests pass, 0 typecheck errors.

## 2026-06-10 14:25

- **Models/agents list alignment with OpenCode config (phase 3 M2 task 5):** Extended `WorkspaceAgentBackend` with `listModels()`, `listProviders()`, and `listAgents()` methods mapping to OpenCode `/api/model`, `/api/provider`, `/api/agent` endpoints via `RawOpencodeClient` HTTP client. Added `OpencodeModelEntry`, `OpencodeProviderEntry`, `OpencodeAgentEntry` domain types with robust payload parsing (`unwrapList`, `mapModelEntry`, `mapProviderEntry`, `mapAgentEntry`). Created `opencodeCatalog` service with per-workspace cached catalog state (`idle`/`loading`/`loaded`/`error`), inflight request deduplication, and deterministic refresh/recovery — `refreshOpencodeCatalog()` fetches all three catalogs in parallel via `Promise.all`. Extended `selection.ts` with `listSelectableWorkspaceModels()` and `resolveWorkspaceModelId()` for workspace model selection from OpenCode catalog. Updated `ChatPanel.svelte` to auto-refresh catalog on workspace open (triggers on `idle` or `error` state) and pass catalog state to `ChatComposer.svelte` via `opencodeCatalog` prop. Updated `ChatComposer.svelte` to use OpenCode catalog models when in workspace context with loaded catalog, falling back to settings-based `ProviderModelCatalogs` when catalog is unavailable. Stale selected model falls back deterministically to first available catalog model via existing `syncComposerModelFallback`. Added "Refresh model list" button to `ConnectionsSettingsPanel.svelte` in the OpenCode section. Added 13 tests for catalog service (refresh, cache, dedup, error handling, model fallback, re-refresh) plus 5 backend tests for catalog listing endpoints including cursor-local stubs. All 1007 tests pass, 0 typecheck errors.

## 2026-06-10 14:05

- **Question prompt modal + reply plumbing (phase 3 M2 task 4):** Added question prompt service (`questionPrompt.ts`) with promise-based runner registration pattern (matching `permissionPrompt.ts`), defaulting to reject when no runner is registered. Created `QuestionPrompt.svelte` modal component showing question prompt text with multi-select checkbox choices, validation that requires at least one selection, Submit/Cancel buttons, backdrop dismiss defaults to reject, escape key cancels. Wired `question.requested` event handling in `executeWorkspaceAgentBackendTurn` stream loop in `chatSendPipeline.ts` — stream pauses on question events, surfaces modal via service, awaits user decision, calls `backend.replyQuestion()` with selected answers or `backend.rejectQuestion()` on cancel, then resumes. Added `isWaitingForQuestion` to `ChatThreadRuntimeState` with `setWaitingForQuestion()` runtime slice method so UI can distinguish generating vs awaiting question input. Handles stale `notFound` reply/reject errors gracefully (breaks stream loop). Multiple sequential question events naturally queue FIFO via sequential `for await` processing. Added 5 stream integration tests covering reply/reject, FIFO queueing, stale recovery, and wait-state tracking, plus 4 service-level tests. All 989 tests pass, 0 typecheck errors.

## 2026-06-10 13:44

- **Permission request modal + reply plumbing (phase 3 M2 task 3):** Added permission prompt service (`permissionPrompt.ts`) with promise-based runner registration pattern (like `entryNamePrompt`), defaulting to reject when no runner is registered. Created `PermissionPrompt.svelte` modal component showing action label with Deny/Allow Once/Always Allow buttons, backdrop dismiss defaults to reject, escape key cancels. Wired `permission.requested` event handling in `executeWorkspaceAgentBackendTurn` stream loop in `chatSendPipeline.ts` — stream pauses on permission events, surfaces modal via service, awaits user decision, calls `backend.replyPermission()` with chosen action (`once`/`always`/`reject`), then resumes. Added `isWaitingForPermission` to `ChatThreadRuntimeState` with `setWaitingForPermission()` runtime slice method so UI can distinguish generating vs awaiting approval. Handles stale `notFound` reply errors gracefully (breaks stream loop). Multiple sequential permission events naturally queue FIFO via sequential `for await` processing. Added 6 stream integration tests covering allow/deny/always-allow, FIFO queueing, stale recovery, and wait-state tracking, plus 4 service-level tests. All 980 tests pass, 0 typecheck errors.

## 2026-06-10 13:19

- **Tool event timeline and cards (phase 3 M2 task 2):** Added `ToolCallRecord`/`ToolCallStatus` domain types and extended `ChatMessage` with optional `toolCalls` array. Created idempotent `toolCallReducer` (`applyToolStarted`/`applyToolCompleted`/`applyToolProgress`) with out-of-order synthetic placeholder handling per event normalization spec. Wired `tool.started`/`tool.completed`/`tool.progress` events in workspace backend stream loop (`chatSendPipeline.ts`), updating assistant message tool call state in real time. Added `updateMessageToolCalls` to thread messages slice. Created `ToolCard.svelte` component (collapsed summary with expandable input/progress/output details, status indicators). Rendered tool cards inline in `ChatMessageList.svelte` below assistant text. Updated persistence codec to serialize/deserialize `toolCalls` on messages. Added 16 reducer tests covering idempotent updates, out-of-order events, multiple concurrent calls, and full lifecycle flows. All 970 tests pass, 0 typecheck errors.

## 2026-06-10 12:39

- **M1.5 Task 6 verification gate + M2 handoff:** Completed phase-3 M1.5 verification by extending contract-aligned backend coverage in `workspaceAgentBackend.test.ts` (explicit prompt send contract assertion) and fixing `appShellAgentHandlers.test.ts` preflight mock typing for current `ChatAccessState`. Updated `specs/ops/phase-3/m1-task5-smoke.md` into an M1.5 Task 6 checklist to cover prompt/tool/permission/question/reject/cancel and restore-reconcile flows in sidecar and URL modes, and added explicit handoff guidance to resume Milestone 2 from `execution-plan-m2.md` Task 2. Marked Task 6 `[DONE]` and completed M1.5 exit criteria in `execution-plan-m1-5.md` after passing `npm test` and `npm run check` (warnings only).

## 2026-06-10 12:34

- **Session mapping restore/reconcile hardening (phase 3 M1.5 task 5):** Integrated workspace-scoped OpenCode session mapping reconciliation into runtime workspace restore flow via `appShellAgentHandlers`: after loading workspace agents and merging session drafts, restore now validates persisted agent->session links against backend session list and deterministically clears stale mappings when remote sessions are missing/deleted, while preserving restore behavior when backend listing is temporarily unavailable (`serverUnavailable`/`transportError`/`authFailure`). Added focused tests in `appShellAgentHandlers.test.ts` for stale-mapping cleanup and unavailable-backend fallback; marked M1.5 Task 5 as `[DONE]` in `execution-plan-m1-5.md`.

## 2026-06-10 11:58

- **Permission/question reply and abort backend commands (phase 3 M1.5 task 4):** Extended `workspaceAgentBackend` with explicit command APIs for permission replies (`reply: once|always|reject`), question replies (`answers: string[][]`), question reject, and session abort semantics for cancel UX. Wired HTTP client routes for OpenCode v2 permission/question reply/reject endpoints and added abort fallback routing (`/api/session/{id}/abort|stop`, then `/session/{id}/abort|stop`) with consistent `WorkspaceAgentBackendError` propagation. Updated workspace send cancellation flow to call backend session abort on turn cancellation and covered the behavior with backend/send tests. Marked M1.5 Task 4 as `[DONE]` in `execution-plan-m1-5.md`.

## 2026-06-10 11:49

- **Exact event normalization rewrite (phase 3 M1.5 task 3):** Reworked OpenCode stream normalization in `workspaceAgentBackend` to follow the phase-3 spec exactly: strict `data`/`properties` envelope parsing, v2-only permission/question mapping, optional `tool.progress`, deterministic dedup by frame id with composite fallback (`type + sessionID + callID + timestamp`), and out-of-order tool lifecycle recovery by emitting synthetic `tool.started` before terminal tool events. Added diagnostic logging for unknown and malformed frames without failing stream consumption, removed `runId` assumptions from normalized `run.completed`/`run.failed` events, updated workspace streaming tests (including duplicate and out-of-order cases), and marked M1.5 Task 3 as `[DONE]` in `execution-plan-m1-5.md`.

## 2026-06-10 11:48

- **Workspace backend contract correction (phase 3 M1.5 task 2):** Reworked `workspaceAgentBackend` and workspace send pipeline to remove run-endpoint assumptions and align with OpenCode canonical contract: session CRUD now uses `/session` + `/api/session`, prompt send uses `/api/session/{sessionID}/prompt`, and streaming uses canonical `/api/event` envelope with bridged `/event` fallback. Updated event normalization to v2 stream types (`session.next.*`, `permission.v2.asked`, `question.v2.asked`, `session.status/session.idle`, `session.error`) and removed `runId` dependency from workspace chat send flow. Refreshed backend/send tests for the new prompt+session-stream semantics and marked M1.5 Task 2 as `[DONE]` in `execution-plan-m1-5.md`.

## 2026-06-10 11:40

- **Docs (phase 3 M1.5 task 1 contract freeze):** Added `specs/ops/phase-3/opencode-contract-freeze-m1-5.md` as a single baseline for frozen OpenCode session/prompt/stream contract assumptions, explicit invalid legacy run-endpoint assumptions to remove, and implementation guardrails for Tasks 2-6. Linked the contract-freeze baseline from `phase-3.md`, milestone plans (`execution-plan-m2.md`, `execution-plan-m3.md`), and marked M1.5 Task 1 as `[DONE]` in `execution-plan-m1-5.md`.

## 2026-06-10 11:34

- **Docs (phase 3 decisions applied):** Resolved Phase 3 OpenCode contract uncertainties with explicit decisions in docs/plans: canonical stream envelope is native `/api/event`; permission/question handling is v2-only (no backward compatibility path); prompt queue policy is single-active-per-session with FIFO; tool-card lifecycle uses idempotent updates plus synthetic placeholders for out-of-order/partial events; model/provider catalog strategy is auto-refresh on open plus manual refresh action; M3 requires full workspace-lane audit (runtime + copy + docs + tests) before closure.

## 2026-06-09 23:55

- **Docs (phase 3 contract alignment package):** Added OpenCode contract references for Phase 3 implementation planning: `specs/ops/phase-3/opencode-api-mapping.md` (SpecOps -> OpenCode endpoint/SDK mapping), `specs/ops/phase-3/opencode-event-normalization-spec.md` (exact stream normalization and idempotency rules), `specs/ops/phase-3/opencode-permission-question-flow.md` (modal/reply behavior), `specs/ops/phase-3/opencode-error-mapping.md` (backend error translation), and `specs/ops/phase-3/opencode-m1-gap-analysis.md` (M1 gap summary).
- **Docs (phase 3 milestone bridge):** Added `specs/ops/phase-3/execution-plan-m1-5.md` to bridge M1 -> M2 with ordered refactor/fix tasks for OpenCode contract alignment before continuing M2 Task 2.
- **Docs (phase 3 execution order update):** Updated `phase-3.md` execution chain to include `m1-5`, linked new contract docs in deliverables, and added changelog row for M1.5 alignment bridge.
- **Docs (milestone plans):** Updated `execution-plan-m2.md` to require M1.5 completion, added Task 1 re-verification note, and adjusted Task 2-6 dependencies/required context to start M2 from Task 2 after M1.5. Updated `execution-plan-m3.md` prerequisites and task details to enforce M1.5 -> M2 -> M3 ordering and to remove remaining workspace HTTP coupling using contract-aligned semantics.

## 2026-06-09 23:24

- **Workspace composer OpenCode stream routing (P3-4 / Task 1):** Added workspace-only (`ws-*`) send path in chat pipeline to execute turns through `WorkspaceAgentBackend("opencode")` while preserving existing `chat-http` provider pipeline. Workspace turns now create/reuse per-agent OpenCode sessions, stream assistant deltas into the active assistant message in real time, and preserve generation lifecycle semantics for success/cancel/error without changing chat-only contexts. Added coverage in `sendChatMessage.test.ts` for ws-context backend routing, stream cancellation behavior, and non-workspace isolation.

## 2026-06-09 23:08

- **Milestone 1 verification (P3-8 partial / Task 5):** Expanded OpenCode runtime coverage across sidecar health transitions and URL checks (`appShellEffects.opencodeSidecar.test.ts`), backend HTTP error mapping and additional stream-event normalization (`workspaceAgentBackend.test.ts`), and sidecar health mapping fallback (`opencodeSidecar.test.ts`). Added manual connectivity smoke checklist for sidecar and URL modes in `specs/ops/phase-3/m1-task5-smoke.md`, and marked Task 5 `[DONE]` plus M1 quality-gate exit criterion complete in `execution-plan-m1.md` after passing `npm test` and `npm run check`.

## 2026-06-09 23:03

- **Workspace agent session mapping (P3-3 / Task 4):** Added persisted per-agent OpenCode session mapping metadata to workspace agent index entries (`opencodeSessionId`, plus optional model/provider restore hints), including codec validation and round-trip coverage in chat persistence tests. Extended chat store agent APIs with workspace-scoped session link set/get/clear helpers and added unit coverage for mapping updates and workspace isolation. Added mapping reconciliation helpers/tests in `workspaceAgentSession` for deterministic recovery when a previously linked remote session is missing.

## 2026-06-09 22:45

- **Workspace backend (OpenCode adapter, P3-2):** Replaced `workspaceAgentBackend` phase-1 stub for `id: "opencode"` with a functional adapter that resolves sidecar/URL client mode, binds every request to workspace `rootPath` as `directory`, and adds backend API for session CRUD, run send, and normalized stream events. Added frontend-safe event normalization boundary (message/tool/permission/question/run events), robust backend error typing and mapping (`authFailure`, `serverUnavailable`, `transportError`, `invalidDirectory`, `invalidResponse`, `notFound`), and preserved `cursor-local` as a phase-5 stub path. Added unit coverage in `workspaceAgentBackend.test.ts` for functional creation, directory validation, stream normalization, and payload validation failures.

## 2026-06-09 22:22

- **Settings + runtime (OpenCode transport + health, P3-6 partial):** Added OpenCode workspace settings schema (`mode`, URL) and runtime health model (`unknown/checking/healthy/degraded/error`, source, last error) with persisted storage and app-state wiring. Implemented Settings UI controls in `ConnectionsSettingsPanel.svelte` for sidecar vs URL mode, URL validation, OpenCode server password secret, health indicator, and manual check action. Wired runtime reconnect/health refresh on mode changes without restart via app shell effects, plus sidecar health normalization and URL health probe. Added OpenCode server password secrets APIs in `providerSecretsStore.ts`.

## 2026-06-09 22:12

- **OpenCode sidecar packaging (P3-1 follow-up):** Added `externalBin` config in `tauri.conf.json`, dev proxy binary at `src-tauri/binaries/opencode-aarch64-apple-darwin`, and leak-prevention unit tests for idempotent stop/teardown state.

## 2026-06-09 21:35

- **OpenCode sidecar (phase 3 / P3-1):** Added Tauri `opencode_sidecar` manager with start/stop/restart/attach/status commands, typed lifecycle errors (`portInUse`, `missingBinary`, `launchFailure`, `healthTimeout`, `staleProcess`), health probing against `/global/health`, hybrid reuse-or-restart attach per workspace `rootPath`, and deterministic teardown on app exit. Frontend bridge in `opencodeSidecar.ts`; workspace attach effect and app-shell cleanup wiring. Tests for Rust attach logic and TS invoke wrappers.

## 2026-06-09 18:22

- **Docs (phase 3 execution):** Added milestone execution plans for OpenCode workspace rollout: [execution-plan-m1.md](./ops/phase-3/execution-plan-m1.md) (sidecar/client/session foundation), [execution-plan-m2.md](./ops/phase-3/execution-plan-m2.md) (stream/tool/permission/question MVP UI), and [execution-plan-m3.md](./ops/phase-3/execution-plan-m3.md) (workspace HTTP cutover, cleanup, and closure). Linked plans from [phase-3.md](./ops/phase-3/phase-3.md).

## 2026-06-09 18:05

- **Docs (roadmap):** Swapped phases 3 and 4 — OpenCode workspace UI is now [phase-3](./ops/phase-3/phase-3.md); Cloud context (`chat-cloud`) is now [phase-4](./ops/phase-4/phase-4.md). Renamed `specs/ops/phase-3/` ↔ `specs/ops/phase-4/` folders and updated cross-references in roadmap, phase-1..7 specs, execution plans, and `workspaceAgentBackend` stub message.

## 2026-06-09 14:45

- **Status bar (Chats/Agents):** In chat/agent tabs, the bottom status bar now shows only console toggle context, status message, and path. Editor-only metadata (Ln/Col, encoding, EOL, zoom, wrap, modified/missing flags) remains visible for file editor tabs.
- **Theme editor + tokens:** Added dedicated text-accent theme tokens for `keyword`, `type`, `link`, and `plaintext-symbol` (`syntax-keyword`, `syntax-type`, `syntax-link`, `syntax-plaintext-symbol`) and grouped them under a new **Text accents** section in theme token schema. Existing accent controls are preserved.
- **Plaintext symbol coloring:** Fixed non-English plaintext handling so Unicode letters/numbers are no longer treated as symbols for accent decoration. Only punctuation/symbol characters are decorated in plaintext mode.
- **Session restore behavior:** Window session restore now falls back to the snapshot of the last active window if the current window has no stored snapshot, while preserving intentional app-level fallback behavior to notepad when active context cannot be restored.
- **macOS dock open/drop:** Updated Tauri bundle file association configuration to a wildcard association (`*/*` / `*`) so opening/dropping extensionless and uncommon files through the dock/app icon is accepted, while existing preview/read-only open behavior remains unchanged.
- **Tests:** Added coverage for Unicode symbol-decoration logic and last-active-window restore fallback; updated theme/token tests to assert the expanded token surface.

## 2026-06-09 12:55

- **Chat UI (context window budgeting):** Added realtime debounced token budget estimate in composer, shown to the left of `Send` as `~used / limit` when a model limit is known (or `~used tokens` otherwise). Estimate includes resolved system prompt + retained history + current draft and updates on draft/thread/model/mode/provider changes.
- **AI internals:** Added shared estimation utility (`app/src/lib/ai/contextWindowBudget.ts`) with lightweight context-limit heuristics for common model ids and initial unit coverage in `contextWindowBudget.test.ts`.
- **Docs:** Updated `phase-2.5-token-ideas.md` marking Context window budgeting as **DONE (UI estimate slice)** with implementation notes; added `specs/backlog.md` to track follow-up ideas/tech debt.

## 2026-06-09 10:00

- **Chat UI:** Composer toolbar simplified — removed Connection, Model, and Mode text labels; mode picker is now a dropdown on the left; connection/model selects sit beside it; Send (and Retry) moved to the right. Applies to both agent and chat-http composers.

## 2026-06-08 15:00

- **Chat modes (token optimization):** Removed duplicated Review section headings from `REVIEW_MODE_SYSTEM_PROMPT`; `sectionInstructions()` via `requiredSections` is now the single source. Added `{{workspace}}` and `{{summary}}` placeholders to Ask, Review, and Raw built-in prompt templates so context toggles affect outgoing system prompts.

## 2026-06-08 14:30

- **Docs:** `phase-2.5-token-ideas.md` — Open questions expanded with answer options and recommended choices.

## 2026-06-08 14:00

- **Docs:** `phase-2.5-token-ideas.md` — added **What to implement** under each gap in “What is missing or weak”; aligned prioritized table Idea column with those section names.

## 2026-06-08 13:00

- **Docs:** Split phase-2.5 backlog into `phase-2.5-token-ideas.md` (detailed token optimization notes) and `phase-2.5-ux-ideas.md` (UX ideas updated for tile grid + editor dialog settings). `phase-2.5-ideas.md` is now an index.

## 2026-06-08 12:30

- **Docs:** Added `specs/ops/phase-2.5/phase-2.5-ideas.md` — backlog of chat-mode token-efficiency gaps and UI/UX improvements (post-M5 review).

## 2026-06-08 12:00

- **Settings UI:** Settings window is 50% wider by default. Opening settings shows a full-window backdrop that blocks interaction with the main app; keyboard shortcuts are suppressed except toggling settings closed.
- **Settings UI:** Fixed Remove button vertical alignment in list rows (connections, required sections) with horizontal inset.
- **Settings chat modes:** Replaced foldout/list layout with a grid of rounded square tiles for built-in and custom modes; clicking a tile opens an editor popup; a `+` tile adds a custom mode.

## 2026-06-08 11:00

- **Global UI:** Bottom panel (console + status bar) now spans the full window width instead of only the editor column. Removed the activity-rail separator between Notepad and Chat/workspace modes.
- **Chat UI:** Removed borders and card background from assistant (AI) message blocks; user and system messages keep bordered styling.

## 2026-06-08 10:15

- **Chats/Agents sidebar UI:** Sidebar list titles truncate at 32 characters with ellipsis; rows show a smaller gray subtitle from the first AI answer. Fixed sidebar overflow (right inset, collapse button moved left of New chat/agent, `overflow: hidden`). New chat/agent button now has a visible border and background. Removed accent highlight styling from agent/chat tabs in the tab bar.

## 2026-06-08 09:30

- **Fix:** Removed duplicate re-export of `nextNumericId` / `sanitizeWindowSnapshot` in `sessionManager.ts` that broke Vite/esbuild on launch.

## 2026-06-08 09:15

- **Settings chat modes:** Added collapsible foldouts for the Built-in modes section in Chat Modes settings; Ask and Review each have nested foldouts (Raw stays inline). New shared `SettingsFoldout.svelte` + `settingsFoldout.css`.

## 2026-06-08 08:48

- **M6 complete (P2-10):** Closed milestone validation (Task 7). Reorganized large test files into `appState/`, `chatStore/`, `commands/handlers/`, and `ai/retryChatTurn.test.ts` (removed broken import-only aggregators). Fixed `settingsSlice` ↔ `registry` circular import via `commandBindingRuntime.ts`; re-exported `nextNumericId` / `sanitizeWindowSnapshot` from `sessionManager.ts`. All audit production files ≤600 lines; test files ≤600 lines. 888 tests; `npm run check` 0 errors. Updated parent M6 exit criteria, `phase-2.md`, and `docs/architecture.md` module-size conventions.

## 2026-06-08 08:31

- **M6.4 Tasks 3-4 (P2-10):** Split chat send pipeline into `ai/sendChatMessage.ts` (public orchestration), `ai/retryChatTurn.ts` (retry flow/guards), and `ai/chatSendPipeline.ts` (shared provider validation, streaming execution, compaction/persistence hooks), keeping exports stable (`sendChatMessage` + `retryLastChatTurn`) and behavior unchanged.
- **M6.4 Task 4 (P2-10):** Extracted app menu builders to `services/appMenuDefinitions.ts` while preserving install/refresh orchestration in `services/appMenu.ts`; extracted external reload policy/runtime helpers to `services/externalFileReloadPolicy.ts`, `services/externalFileChangesRuntime.ts`, and `services/externalFileChangesTypes.ts`, keeping watcher/focus/tab/startup orchestration in `services/externalFileChanges.ts`.
- Updated `execution-plan-m6-4-platform-refactoring.md` to mark Tasks 3 and 4 as `[DONE]`. Verified with `npm test -- src/lib/ai/sendChatMessage.test.ts src/lib/services/appMenu.test.ts src/lib/services/externalFileChanges.test.ts src/lib/services/externalFileChanges.helpers.test.ts` and `npm run check` (0 errors; existing warnings unchanged).

## 2026-06-08 08:08

- **M6.4 Tasks 1-2 (P2-10):** Split command registry into `commands/definitions.ts` plus grouped handler modules under `commands/handlers/` (`app.ts`, `file.ts`, `workspace.ts`, `edit.ts`, `view.ts`) with shared `fileActions.ts`; `registry.ts` now retains handler merge, dispatch, keymap lookup, registered ids, active document content, and binding override wiring while re-exporting `commandDefinitions` for backward compatibility. `registry.ts` is 129 lines and each required handler module is <= 250 lines.
- **M6.4 Task 2 (P2-10):** Split chat persistence into `chatPersistenceCodec.ts` (encode/decode, index helpers, compaction helpers, hash key), `chatPersistencePaths.ts` (scope segment + agents/index path resolvers), and a thinner `chatPersistence.ts` for read/write, debounce scheduling, persist/delete orchestration, and backward-compatible re-exports. Persistence behavior and APIs are unchanged for current consumers/tests.
- Updated `execution-plan-m6-4-platform-refactoring.md` to mark Tasks 1 and 2 as `[DONE]`. Verified with `npm test -- src/lib/commands/registry.test.ts src/lib/services/chatPersistence.test.ts src/lib/services/chatPersistence.retention.test.ts` and `npm run check` (0 errors; existing warnings unchanged).

## 2026-06-07 23:55

- **M6.3 Task 4 (P2-10):** Split `chatStore/threads.ts` into focused modules: `threadMessages.ts` (`appendMessage`, `updateMessageContent`, `removeMessage`, `compactActiveThread`, `getMessages`), `threadMetadata.ts` (`setAgentThread`, `setWorkspaceThread`, `updateThreadMetadata`, metadata/thread snapshot accessors), and `threadProviderSelection.ts` (provider/connection/model getters and switch flows with diagnostics/logging). `createThreadsSlice` now composes these slices while preserving the public `chatStore` API. Marked M6.3 Task 4 and exit criteria complete. Verified with `npm test -- chatStore/threadMessages.test.ts chatStore/threadProviderSelection.test.ts` and `npm run check` (0 errors).

## 2026-06-07 23:44

- **M6.3 Task 3 (P2-10):** Split `settingsSlice.ts` into `settingsSlice.ts` (composer, `defaultSettings`, command bindings, `applyPersistedSettings`), `providerSettingsSlice.ts` (debug/HTTP providers, API keys, model catalogs), `chatModesSettingsSlice.ts` (raw/builtin/custom mode CRUD), and `logSettingsSlice.ts` (log settings mutators). `createSettingsSlice` composes all four; `appState` public API unchanged. Largest settings slice file 277 lines (≤350). M6.1 settings CRUD tests pass; `npm test` and `npm run check` pass.

## 2026-06-07 23:41

- **M6.3 Task 2 (P2-10):** Split `documentTabsSlice.ts` into `documentTabsSlice.ts` (tab lifecycle), `documentContentSlice.ts` (document mutations), and `tabTransferSlice.ts` (cross-window transfer/migration); moved shared tab helpers (`canCreateFileTabs`, `selectTabInternal`, `reopenTabForDocument`) to `tabHelpers.ts`. `createDocumentTabsSlice` composes all three; `appState` public API unchanged. Largest slice file 349 lines (≤450). `npm test` and `npm run check` pass.

## 2026-06-07 23:38

- **M6.3 Task 1 (P2-10):** Split `domain/contracts.ts` into focused modules (`document`, `workspace`, `settings`, `chat`, `commands`, `persistence`); `contracts.ts` is now a 79-line barrel re-export. Added `domain/contracts.barrel.test.ts` smoke test. Test count 920 → 923; `npm test` and `npm run check` pass.

## 2026-06-07 23:29

- **M6.2 Tasks 7–8 (P2-10):** Extracted `editorCommandRunner.ts` and view-bound search ops in `editorSearchOps.ts` from `EditorSurface.svelte` (301 lines, ≤350). Extracted tab context menu handlers to `tabContextMenuActions.ts`, `TabBarNearbySubmenu.svelte`, and `tab-context-menu.css` (281 lines, ≤350). Extracted `agentsSidebarController.ts`, `AgentSidebarRow.svelte`, and `agents-sidebar.css` from `AgentsSidebar.svelte` (220 lines, ≤400). M6.2 exit criteria satisfied; `npm test` and `npm run check` pass.

## 2026-06-07 23:24

- **M6.2 Tasks 5–6 (P2-10):** Extracted reactive side effects from `+page.svelte` into `appShellEffects.ts` (4 thin `$effect` wrappers) plus `appShellPageHandlers.ts` and `appShellDocumentView.ts` — shell route is 572 lines (≤600). Extracted `ChatModePicker`, `ChatConnectionPicker`, `composerSendActions.ts`, `composerSelectionActions.ts`, and `composerSelectionEffects.ts` from `ChatComposer.svelte` (297 lines, ≤350). `npm test` and `npm run check` pass.

## 2026-06-07 23:18

- **M6.2 Task 4 (P2-10):** Extracted `+page.svelte` handler groups into `appShellProjectTreeHandlers.ts`, `appShellAgentHandlers.ts`, `appShellLayoutHandlers.ts`, and extended `workspaceContextMenuController.ts` with `createWorkspaceContextMenuActions`. `+page.svelte` is 790 lines (≤800 target). `npm test` and `npm run check` pass.

## 2026-06-07 23:16

- **M6.2 Task 3 (P2-10):** Extracted app shell layout from `+page.svelte` into `AppShell.svelte` (ActivityRail, AgentsSidebar, TabBar, editor pane routing, ProjectPanel, ConsolePanel, FindReplacePanel, overlays). Grouped props into typed objects (`activityRail`, `agentsSidebar`, `projectTree`, `editor`, `statusBar`, `workspaceContextMenu`, `overlays`); `+page.svelte` is 1186 lines (202-line reduction). `npm test` and `npm run check` pass.

## 2026-06-07 23:13

- **M6.2 Task 2 (P2-10):** Extracted settings dialog drag/resize handlers and size measurement to `settings/settingsDialogChrome.ts`, dialog layout styles to `settingsDialogChrome.css`, and hidden measurement panels to `SettingsDialogMeasure.svelte`. `SettingsDialog.svelte` is 288 lines (≤450 target). Test count 916 → 920; `npm test` and `npm run check` pass.

## 2026-06-07 23:10

- **M6.2 Task 1 (P2-10):** Extracted settings tab panels from `SettingsDialog.svelte` into `app/src/lib/components/settings/` (`EditorSettingsPanel`, `ConnectionsSettingsPanel`, `ChatModesSettingsPanel`, `DebugProviderSettingsPanel`, `LogsSettingsPanel`, `ProviderModelCatalogPanel`); moved connection/debug parsing helpers to `settingsPanelActions.ts` and shared list styles to `settingsPanelLists.css`. Shell is 587 lines; all panels ≤331 lines. Test count 908 → 916; `npm test` and `npm run check` pass.

## 2026-06-07 23:06

- **M6.1 Tasks 7–8 (P2-10) complete:** Extracted `settingsPanelActions.ts` (external-files KB normalization, connection/mode list selection, required-section mutations) and `workspaceContextMenuController.ts` (close-workspace prompt flow, reorder bounds) with unit tests; wired into `SettingsDialog.svelte` and `+page.svelte`. Fixed pre-existing `svelte-check` errors in M6.1 test files and `TabBarContextMenu.svelte`. Test count 873 → 908; `npm test` and `npm run check` pass. M6.1 exit criteria satisfied.

## 2026-06-07 22:52

- **M6.1 Tasks 5–6 (P2-10):** Added `closeTabFlow.test.ts` and `tabContextMenuActions.ts` (+ tests) for unsaved-close flows and tab context menu capability helpers; extracted `editorLineOps.ts` and `editorSearchOps.ts` from `EditorSurface` with unit tests. Test count 846 → 873.

## 2026-06-07 22:49

- **M6.1 Tasks 3–4 (P2-10):** Added `threadMessages.test.ts` and `threadProviderSelection.test.ts` covering `updateMessageContent`, `removeMessage`, `compactActiveThread`, and `switchThreadConnection` via public `chatStore` APIs.
- Extended `registry.test.ts` with dispatch tests for all previously untested command handlers (file open/recent/save-as/rename/reload, app toggles, edit/view commands, tab navigation); test count 779 → 846.

## 2026-06-07 22:41

- **M6.1 Tasks 1–2 (P2-10):** Added `settingsSlice.test.ts` covering HTTP connection CRUD, chat mode mutators, debug provider patches, and provider catalog/API key updates via public `appState` APIs.
- Added `documentTabsSlice.test.ts` for `migrateNotepadFileTabToWorkspace` (move, duplicate-focus, guard paths) and `renameDocument` behavior; marked M6.1 Tasks 1–2 done in execution plan.

## 2026-06-07 22:30

- Added M6.1 pre-refactor test coverage sub-milestone ([execution-plan-m6-1-test-coverage.md](./ops/phase-2/execution-plan-m6-1-test-coverage.md)) as the first M6 step before production refactors.
- Renamed M6 sub-plans to numbered sub-milestones (M6.1 tests, M6.2 UI, M6.3 state, M6.4 platform); updated parent plan, phase-2 links, and execution order (M6.1 → M6.2 ∥ M6.3 → M6.4).

## 2026-06-07 22:10

- Fixed chats/workspace interaction regressions in app shell by removing debug-only instrumentation from `+page.svelte`, `AgentsSidebar.svelte`, and `ChatPanel.svelte` after validation.
- Preserved behavior fixes: reliable sidebar toggle/new-chat pointer handling in `AgentsSidebar` and agent id counter synchronization in chat store to prevent duplicate-key crashes when creating chats.

## 2026-06-07 22:00

- Added M6 execution plan for behavior-preserving codebase refactoring: parent [execution-plan-m6-refactoring.md](./ops/phase-2/execution-plan-m6-refactoring.md) plus sub-plans [M6-UI](./ops/phase-2/execution-plan-m6-ui-refactoring.md), [M6-State](./ops/phase-2/execution-plan-m6-state-refactoring.md), and [M6-Platform](./ops/phase-2/execution-plan-m6-platform-refactoring.md).
- Documented 2026-06-07 audit findings (tier 1–3 oversized files) with task breakdowns covering settings dialog, app shell, state slices, commands, services, domain types, and large test splits.
- Updated [phase-2.md](./ops/phase-2/phase-2.md) with M6 milestone summary and P2-10 task id.

## 2026-06-07 21:26

- Fixed chat/workspace agents sidebar collapse behavior in app shell: chat now honors manual sidebar collapse state, and toggle behavior is no longer misleading while responsive auto-collapse is active.
- Added disabled-state UX for the agents sidebar collapse button when auto-collapse is enforced by viewport width, including a tooltip hint to expand the window.
- Tightened collapsed agents sidebar header/button layout styles to prevent visual overflow into the tab strip area.
- Added responsive layout regression coverage for agents sidebar auto-collapse behavior outside workspace context.

## 2026-06-07 20:17

- **M5 Task 7 (P2-9):** Finalized custom chat modes validation and documentation by extending milestone tests for chat-http/custom-mode coverage and resolving a test-run unhandled persistence side effect in `chatM6-4.validation.test.ts` via chat persistence mocking.
- Verified milestone quality gate from `app/`: `npm test` and `npm run check` pass (with one pre-existing Svelte accessibility warning in `EntryNamePrompt.svelte`).
- Marked M5 Task 7 and Milestone 5 exit criteria complete in execution docs; updated phase-2 milestone table to reflect M5 done.

## 2026-06-07 20:10

- **M5 Tasks 5–6 (P2-9):** Unified mode availability across workspace and chat-http composers by removing ask-only chat-http filtering/coercion, deriving selectable modes from settings resolver, and auto-falling back in UI when a stale disabled mode is present.
- Removed chat-http mode normalization to Ask from thread scope/load/store paths so persisted Review/custom modes are preserved and sent as selected.
- Extended HTTP/Debug provider capability mode support to resolver-driven dynamic mode ids (including `raw` and enabled custom modes), updated unsupported-mode recovery copy to point users to Settings → Chats → Chat modes, and refreshed provider/store validation tests accordingly.

## 2026-06-07 19:58

- **M5 Task 4 (P2-9):** Added Settings → Chats → Chat modes tab with built-in mode cards (Ask/Review/Raw) showing read-only prompt templates, required sections, editable context toggles, and Raw enable control.
- Added custom mode management UI in settings: add/select/remove/enable, mode name and prompt editor with `{{workspace}}` / `{{summary}}` hint, include-workspace/include-summary toggles, optional section guidance, and ordered required-sections editor (add/remove/reorder).
- Registered `openSettingsDialog("chatModes")` deep-link support and updated settings tab/sidebar definitions and tests for the new tab layout.

## 2026-06-07 19:45

- **M5 Task 3 (P2-9):** Generalized structured assistant message parsing from Review-only behavior to mode-driven `requiredSections` with case-insensitive heading matching.
- Updated chat UI wiring so `ChatPanel` resolves the active mode and passes `requiredSections` to `ChatMessageList`, which now renders section cards for any structured mode while preserving streaming plain-text behavior until completion.
- Expanded parser tests to cover arbitrary section lists, case-insensitive matches, and conversational fallback behavior.

## 2026-06-07 19:40

- **M5 Task 2 (P2-9):** Reworked prompt assembly to resolve mode system text from settings-driven mode definitions with `{{workspace}}` / `{{summary}}` placeholders, per-mode toggles, structured required-section instructions, chat-http workspace label handling (`Workspace: Chats (chat-http)`), and pre-resolved provider payload system prompts.
- Refactored send path to build provider payloads from resolved mode context and removed hardcoded workspace/summary appends from OpenAI message assembly.
- Expanded mode prompt tests to cover Ask toggle-off behavior, custom placeholder substitution, Review required sections, and Raw persona-free output.

## 2026-06-07 19:30

- **M5 Task 1 (P2-9):** Custom chat mode schema, settings persistence, and resolver — widened `ChatModeId`, added `ChatModesSettings` / `ResolvedChatMode`, built-in Raw mode definition, preset custom modes in defaults, settings slice CRUD helpers, `resolveChatMode` / `listSelectableChatModes`, and thread mode parse normalization.

## 2026-06-07 16:30

- Renamed M5 execution plan to [execution-plan-m5-custom-modes.md](./ops/phase-2/execution-plan-m5-custom-modes.md) (was `execution-plan-m4-custom-modes.md`).
- Updated [phase-2.md](./ops/phase-2/phase-2.md) with M5 milestone summary and P2-9 task id.

## 2026-06-07

- Added verbose provider logging: full request/response payloads are written to the console when enabled (default on). Toggle in Settings → Logging → Logs.
- Added Settings sidebar section **Logging** with a **Verbose provider logging** option.
- Chat composer clears the input immediately on send and appends the user message before async validation, so messages appear in the thread without waiting for preflight.

## 2026-07-11 23:30

- **M2.1 (Multiple-Selection Engine):** Enabled native multi-cursor and column selection across all text/Markdown editor panes by adding `EditorState.allowMultipleSelections.of(true)`, `drawSelection()`, and the `@codemirror/search` extension to the base extension group. Added `@codemirror/search` as a direct dependency.
- **M2.1-2 (Occurrence-selection actions):** Added `editorSelectionOps.ts` implementing select-next, select-all, skip, and remove-last occurrence operations. Select-next wraps once then reports "No more occurrences"; skip advances the main range without growing the count; remove-last drops the most recently added secondary range. Wired all four into the domain API `actions.selection` group, `EditorCommandRunner` adapter, and capability reporting.
- **M2.1-3 (Multi-range line ops):** Verified and extended test coverage confirming move up/down, duplicate, and join line operations are multi-range safe — they deduplicate shared lines, preserve all selection ranges, and collapse into one undoable transaction. Search navigation intentionally replaces the full selection (documented behavior).
- **M2.2-1 (Command registration and binding transfer):** Added four new commands (`edit.selectNextOccurrence`, `edit.selectAllOccurrences`, `edit.skipOccurrence`, `edit.undoOccurrence`) with definitions, handlers, and native menu items. **Reassigned `Cmd/Ctrl+D` from `edit.duplicateLine` to `edit.selectNextOccurrence`.** Duplicate line received `Cmd/Ctrl+Alt+D` (Cmd+Shift+D was unavailable — owned by `view.toggleDiffPreview`). Select-all bound to `Cmd/Ctrl+Shift+L`; skip and remove-last left palette-visible but unbound. Updated the `SELECT_NEXT_OCCURRENCE_BINDING_DECISION` constant to reflect the completed transfer.
- **M2.2-2 (Selection count feedback):** Extended `EditorCursorStatus`, `publishCursorStatus`, `updateCursor()`, app state, and the status bar to report selection count. A compact "N selections" segment appears in the footer only when more than one selection is active, with an accessible aria-label. Inactive panes do not affect active-pane status.
- **M2.2-3 (Cross-feature validation):** Added integration tests verifying multi-cursor typing/deleting edits every range in one undo step, occurrence selection followed by synchronized typing, occurrence non-overlap guarantees, line-op selection preservation, and save-content parity with visible multi-range edits. All 2750 tests pass; `npm run check` reports 0 new errors.
