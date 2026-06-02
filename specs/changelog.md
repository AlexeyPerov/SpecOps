# Changelog

## 2026-06-02 — macOS dock menu Open Recent

- **Dock menu:** Right-click on the dock icon now lists the same recent files as **File → Open Recent** (formatted paths, **Clear Recent**), kept in sync via `refresh_dock_menu`; selections emit `spec-ops/dock/open-recent` / `spec-ops/dock/clear-recent`.

## 2026-06-02 17:10 — Build warnings (dock menu, ThemePane CSS)

- **macOS dock menu:** Reimplemented `dock_menu.rs` with `objc2` / `objc2-app-kit` (removed deprecated `cocoa` / `objc`); dropped erroneous `mem::forget` on menu target.
- **ThemePane:** Split `settingsFormMultiline.css` from `settingsForm.css` so scoped imports no longer trigger unused `textarea` / `select` selector warnings; `SettingsDialog` imports both.

## 2026-06-02 — Window sizing and tab transfer follow-up

- New windows copy size from the **current** parent window (`readWindowBounds`) instead of stale persisted bounds; size is applied only via `applyWindowBounds` after create.
- Dragging a tab onto another window merges it there (`spec-ops/window/merge-tab`) instead of always spawning another window.
- After the last real tab leaves, source windows with only an empty bootstrap tab (or no tabs) close automatically.

## 2026-06-02 15:56 — Window, tabs, and unsaved-close UX

- **New window sizing:** Secondary windows inherit logical size from persisted `session.windowBounds` or the parent window via `readWindowBounds()` (fixes Retina 2× oversize); `applyWindowBounds()` runs after create.
- **macOS dock menu:** Dock icon context menu adds “New Window” (`spec-ops/dock/new-window` → `app.newWindow`).
- **Cmd+N:** File menu “New Tab” with `CmdOrCtrl+N`; editor focus no longer blocks `file.new` / save / `tab.close` (`EDITOR_GLOBAL_COMMANDS`).
- **Tab tear-off:** 2D drag threshold and tear-off when dragging outside the tab strip; dirty tabs prompt before transfer.
- **Unsaved close:** Native Save / Don’t Save / Cancel dialog (`@tauri-apps/plugin-dialog` `message`) on tab close (X, Cmd+W, context menu, bulk close).

## 2026-06-02 — Refactoring R1–R3 complete (R3-8)

Milestone series **R0 → R1 → R2 → R3** is complete. Validation: `npm test` (590 tests), `npm run check` (0 errors; pre-existing `ThemePane.svelte` CSS warnings only).

**R0 — Test baseline:** Unit tests and pure extractions for shell/services (`openActivePath`, `windowBounds`, `settingsDialogUi`, `fileWatcher`, `appShellHelpers`) before structural refactors.

**R1 — App shell decomposition:** Extracted `appShellRuntime.ts` and project-tree logic from `+page.svelte`; unified markdown preview on per-document `markdownViewMode`; added `MarkdownEditorPane`, `DiffPreviewPane`, `DocumentEditor`; reduced page script surface.

**R2 — State store decomposition:** Split `appState` into colocated modules (`contextHelpers`, `documentTabsSlice`, `workspaceContextsSlice`, `settingsSlice`, `themeController`, …) and `chatStore` into `agents`, `threads`, `runtime`, `access`, …; removed legacy top-level `documents`/`session` mirror (single source of truth in context snapshots); decomposed `TabBar` (~287 lines) and `ChatPanel` (~298 lines) into subcomponents.

**R3 — Provider abstraction and polish:** Provider-keyed `provider-secrets.json` and `providerSettings` bundle in `settings.json`; `SETTINGS_TABS` registry for settings dialog; DRY keymaps via `expandPlatformKeymaps()`; shared `DRAFT_AGENT_TITLE` and `getErrorMessage()`; Svelte 5 runes in `+page.svelte`, `TabBar`, `EditorSurface`.

Updated `docs/architecture.md` (state layout, secrets store, settings tab registry, keymap helper, runes). Marked `Task R3-8` as `[DONE]` in `specs/refactoring-1/r3-execution-plan.md`.

## 2026-06-02 — R3 provider settings bundle (R3-7)

- Added `ProviderSettingsBase`, `ProviderSettingsById`, and `AppProviderSettings`; `AppSettingsState` now uses `providerSettings: { glm, debug }` instead of top-level `glmProvider` / `debugProvider`.
- Added `appProviderSettings.ts` with `normalizeAppProviderSettings`, `getProviderSettings`, and defaults; persisted `settings.json` uses `providerSettings` (breaking change — no read of legacy top-level provider keys).
- Updated settings slice, store, bootstrap, ChatPanel, Settings dialog, and tests.
- Documented final settings shape in `docs/providers.md`.
- Marked `Task R3-7` as `[DONE]` in `specs/refactoring-1/r3-execution-plan.md`.

## 2026-06-02 — R3 Svelte 5 migration: +page.svelte (R3-6)

- Migrated `+page.svelte` from legacy `$:` reactivity to Svelte 5 runes: local UI state via `$state`, store subscriptions via `$derived($appState)` / chat stores, side effects (persistence, project tree, chat workspace sync, tab activation, responsive layout) via `$effect`.
- Renamed derived app store binding to `snapshot` to avoid shadowing the `$state` rune.
- Marked `Task R3-6` as `[DONE]` in `specs/refactoring-1/r3-execution-plan.md`.

## 2026-06-02 — R3 Svelte 5 migration: EditorSurface and TabBar (R3-5)

- Migrated `EditorSurface.svelte` from `export let` / `$:` to `$props()`, `$state`, and `$effect` (document scroll, wrap, zoom, content sync, language, plaintext decorations).
- Migrated `TabBar.svelte` and `TabBarContextMenu.svelte` to `$props()`, `$state`, and `$derived`; preserved `registerEditorCommandRunner` and tab context menu public API.
- Marked `Task R3-5` as `[DONE]` in `specs/refactoring-1/r3-execution-plan.md`.

## 2026-06-02 — R3 keymap DRY and shared error/title constants (R3-3, R3-4)

- Added `expandPlatformKeymaps()` in `registry.ts` to build `keyBindingsByPlatform` from each command definition's `binding.mac` / `binding.windows`; removed ~50 lines of duplicated Meta/Ctrl maps.
- Added `getErrorMessage(error, fallback?)` in `commandErrors.ts` and replaced repeated `error instanceof Error ? …` patterns in `+page.svelte`, `appShellRuntime.ts`, `sessionManager.ts`, `markdownPreviewLinks.ts`, and `openActivePath.ts`.
- Replaced hardcoded `"New agent"` in `TabBar.svelte`, `ChatPanel.svelte`, and `AgentsSidebar.svelte` with `DRAFT_AGENT_TITLE` from `chatAgents.ts`.
- Added unit tests for `expandPlatformKeymaps` and `getErrorMessage`.
- Marked `Task R3-3` and `Task R3-4` as `[DONE]` in `specs/refactoring-1/r3-execution-plan.md`.

## 2026-06-02 — R3 provider secrets and settings tab registry (R3-1, R3-2)

- Added `providerSecretsStore.ts` with provider-keyed `provider-secrets.json` (`{ version: 1, keys: Partial<Record<ChatProviderId, string>> }`); removed `glm-secrets.json` / `glmSecretsStore.ts` without migration (re-enter GLM API key after upgrade).
- Added `appState.setProviderApiKey(providerId, key)`; kept `setGlmApiKey` as a thin `"glm"` wrapper for existing tests.
- `appShellRuntime.ts` and Settings dialog GLM key field now load/save via `loadProviderApiKey` / `saveProviderApiKey`.
- Renamed tests to `providerSecretsStore.test.ts` with merge/remove key coverage.
- Added `SETTINGS_TABS` registry and `SettingsTabDefinition` in `settingsDialogUi.ts`; Settings dialog sidebar and tab panels render from registry order (`editor`, `glm`, `debugAi`).
- Updated `docs/providers.md` and `docs/architecture.md` for new secrets path/shape.
- Marked `Task R3-1` and `Task R3-2` as `[DONE]` in `specs/refactoring-1/r3-execution-plan.md`.

## 2026-06-02 08:26 — R2 ChatPanel decomposition and validation (R2-8, R2-9)

- Extracted `ChatComposer.svelte` for draft input, send/retry, and provider/mode/model selectors (`sendChatMessage` / `retryLastChatTurn` called from composer).
- Extracted `ChatBlockedState.svelte` for access blocked and provider config alarm UI with Settings CTA.
- `ChatPanel.svelte` reduced from ~1080 to ~298 lines (layout, header, derived state, wiring only).
- Updated `docs/architecture.md` with `appState/` and `chatStore/` module tables and ChatPanel/TabBar subcomponent paths.
- Marked `Task R2-8` and `Task R2-9` as `[DONE]` in `specs/refactoring-1/r2-execution-plan.md`.
- R2 exit criteria confirmed: `appState.ts` 298 lines, `chatStore.ts` 144 lines, `TabBar.svelte` 287 lines, `ChatPanel.svelte` 298 lines; `npm test` (582 tests), `npm run check` (pre-existing ThemePane CSS warnings only).

## 2026-06-02 07:48 — R2 TabBar decomposition (R2-7)

- Extracted `TabBarContextMenu.svelte` for tab context menu UI and actions (close variants, rename, reveal, copy path, nearby files submenu).
- Extracted `tabDragController.ts` for pointer drag state machine, tab reorder preview, and tear-off-to-new-window via `DRAG_THRESHOLD_PX`.
- `TabBar.svelte` reduced from ~1003 to ~287 lines (strip rendering and wiring only).
- Marked `Task R2-7` as `[DONE]` in `specs/refactoring-1/r2-execution-plan.md`.
- Validation: `npm test` (582 tests), `npm run check` (pre-existing ThemePane CSS warnings only).

## 2026-06-02 07:40 — R2 remove legacy documents/session mirror (R2-6)

- Removed top-level `documents` and `session` from `AppDomainState`; active context data lives only in `WindowContextState` snapshots.
- Added `patchActiveContext`, `getActiveDocuments`, and `getActiveSession` in `contextHelpers.ts`; document/tab and workspace slices mutate via `patchActiveContext` instead of legacy sync wrappers.
- Removed `syncLegacyFieldsIntoActiveContext` and `withActiveContextApplied` from `appState.ts`; store `update()` applies mutators directly.
- Updated `+page.svelte`, command registry, external file services, and tests to use getters or `getActiveContextSnapshot`.
- Documented single-source-of-truth shape in `docs/architecture.md`. Marked `Task R2-6` as `[DONE]` in `specs/refactoring-1/r2-execution-plan.md`.
- Validation: `npm test` (582 tests), `npm run check` (pre-existing ThemePane CSS warnings only).

## 2026-06-01 22:46 — R2 chatStore module split (R2-5)

- Added `app/src/lib/state/chatStore/` with `types.ts`, `workspace.ts`, `threadHelpers.ts`, `agents.ts`, `threads.ts`, `runtime.ts`, and `access.ts`; slice factories merge into `createChatStore()` while public API and derived exports stay on `chatStore.ts`.
- `chatStore.ts` reduced from ~1500 to ~144 lines (facade wires agents, threads, runtime, and access slices; re-exports types, `createAgentId`, `formatCompactionNotice`, `resetAgentIdCounterForTests`, `setDefaultChatProviderResolver`).
- Marked `Task R2-5` as `[DONE]` in `specs/refactoring-1/r2-execution-plan.md`; validation run: `npm test` passed (582 tests), `npm run check` passed with pre-existing `ThemePane.svelte` CSS warnings only.

## 2026-06-01 22:40 — R2 document/tab and workspace context slice extraction (R2-4)

- Added `app/src/lib/state/appState/documentTabsSlice.ts` with tab CRUD, agent tabs, file open/transfer, and document mutators via `createDocumentTabsSlice({ update, getSnapshot })`.
- Added `app/src/lib/state/appState/workspaceContextsSlice.ts` with context switch, workspace open/close, session restore/snapshot, layout mutators, and agent-id tracking via `createWorkspaceContextsSlice(...)`.
- `appState.ts` reduced from ~1290 to ~356 lines; merges `workspaceContextsSlice`, `documentTabsSlice`, and `settingsSlice` into the public store API. Legacy sync helpers remain in facade until R2-6.
- Marked `Task R2-4` as `[DONE]` in `specs/refactoring-1/r2-execution-plan.md`; validation run: `npm test` passed (582 tests), `npm run check` passed with pre-existing `ThemePane.svelte` CSS warnings only.

## 2026-06-01 22:36 — R2 appState decomposition scaffold (R2-1, R2-2, R2-3)

- **R2-1:** Added `app/src/lib/state/appState/` with pure helper modules: `contextHelpers.ts` (context snapshots, workspace lookup, document path lookup, ID counters), `documentHelpers.ts` (build/normalize document helpers), `tabHelpers.ts` (tab reorder/bulk-close helpers). `appState.ts` reduced from ~1940 to ~1300 lines; re-exports `findWorkspaceByPath`, `resetThemePersistenceForTests`, `setThemeSaveErrorNotifier`.
- **R2-2:** Extracted theme persistence, DOM application, and custom-theme transforms into `app/src/lib/state/appState/themeController.ts`; store theme methods delegate to the controller.
- **R2-3:** Extracted settings defaults and provider/catalog mutators into `app/src/lib/state/appState/settingsSlice.ts` via `createSettingsSlice(update)`; `createStateStore` merges slice methods into the public store API.
- Marked `Task R2-1`, `Task R2-2`, and `Task R2-3` as `[DONE]` in `specs/refactoring-1/r2-execution-plan.md`; validation run: `npm test` passed (582 tests), `npm run check` passed with pre-existing `ThemePane.svelte` CSS warnings only.

## 2026-06-01 22:38 — R1 project tree controller + shell CSS extraction (R1-6, R1-7)

- Added `app/src/lib/services/projectTreeController.ts` to own project-tree state (`rootNodes`, `childrenByPath`, `expandedPaths`, `loadingPaths`, `showHidden`) and behavior (`loadProjectTreeRoot`, child loading, directory toggle, refresh, hidden toggle, active-file ancestor expansion).
- Added `app/src/lib/services/projectTreeController.test.ts` with coverage for ancestor expansion path derivation and controller expansion/loading behavior.
- Updated `app/src/routes/+page.svelte` to consume `projectTreeController` instead of local project-tree `Map`/`Set` state and manual ancestor-reactive blocks; `ProjectPanel` now receives controller state props.
- Extracted shell styles from `+page.svelte` into `app/src/lib/styles/app-shell.css` and imported the stylesheet from the route component.
- Marked `Task R1-6` and `Task R1-7` as `[DONE]` in `specs/refactoring-1/r1-execution-plan.md`; validation run: `npm test` passed (582 tests), `npm run check` passed with pre-existing `ThemePane.svelte` CSS warnings only.

## 2026-06-01 22:14 — R1 appShellRuntime extraction (R1-5)

- Added `app/src/lib/services/appShellRuntime.ts` with `startAppShellRuntime(options)` to own startup/runtime orchestration previously in `+page.svelte`: persisted settings/theme + GLM key load, chat provider bootstrap, logging init, session restore + bounds apply, open-file registry sync, startup external checks, watcher-path sync, and initial `take_pending_opened_paths` consume.
- Moved app-shell listeners into runtime service: transfer tab, app/window opened paths, activate-file routing, select-tab-for-path, file changed watcher events, window ready/focus/resize/move, drag-drop open, window destroyed handling, and recent-files menu sync.
- Simplified `app/src/routes/+page.svelte` by replacing `setupRuntime` and local watcher-sync/window-listener setup with a single `startAppShellRuntime(...)` call and a runtime-provided `syncExternalFileWatcher` handle.

## 2026-06-01 22:05 — R1 preview unification (R1-3, R1-4)

- **R1-3:** Removed global `previewMode === "markdown"` branch from `+page.svelte`. `view.toggleMarkdownPreview` now cycles the active markdown document's `markdownViewMode` (`edit` ↔ `preview`; split → preview on shortcut). Non-markdown files get a status message. `setPreviewMode("markdown")` normalizes to `"editor"`. Added command and appState tests.
- **R1-4:** Added `DiffPreviewPane.svelte` with saved vs current diff grid; moved `diffLines` usage and diff CSS from page. Page uses `{#if previewMode === "diff"}<DiffPreviewPane />{:else}…{/if}`. Removed `diffLines` import from `+page.svelte`.

## 2026-06-01 22:02 — R1 app shell decomposition (R1-1, R1-2)

- **R1-1:** Added `DocumentEditor.svelte` — wraps `EditorSurface` with standard props, `appState.setDocumentContent` on dirty, and optional `onUntitledTitleRefresh` callback. Replaced three duplicated `EditorSurface` blocks in `+page.svelte`.
- **R1-2:** Added `MarkdownEditorPane.svelte` — mode bar (edit/split/preview), preview/split/edit layouts, `{@html}` preview with link handling, split-scroll sync moved from page. Page renders `{#if isMarkdownDocument}<MarkdownEditorPane />{:else}<DocumentEditor />{/if}` in editor mode. Markdown layout CSS colocated in pane component.

## 2026-06-01 21:58 — R0 test baseline (R0-6 through R0-9)

Completed recommended command/menu test tasks and R0 milestone validation.

- **R0-6:** Added `app/src/lib/services/appMenu.test.ts` — open-recent path queue round-trip, empty queue, menu gating (`shouldInitializeAppMenu`).
- **R0-7:** Extended `app/src/lib/commands/registry.test.ts` — handler coverage for `file.save`, `file.saveAll`, `file.new`, `tab.close`, `workspace.add`, `workspace.close` (success, cancel, and discard branches).
- **R0-8:** Extended `registry.test.ts` — Windows/Linux `Ctrl+*` keymap parity and binding parity for all `commandDefinitions` entries with shortcuts.
- **R0-9:** Validation gate — `npm test` and `npm run check` green.

**Test inventory:** **573** tests in **68** files (plan baseline: 506 / 62). R0 milestone added **6** colocated test files (`openActivePath`, `appShellHelpers`, `windowBounds`, `settingsDialogUi`, `fileWatcher`, `appMenu`) plus registry extensions; **~67** new cases total (**~23** from R0-6–R0-8).

## 2026-06-01 (R0-3, R0-4, R0-5)

- **R0-3:** Added `windowBounds.test.ts` — scale-factor division on read, maximized-only apply path, logical size/position on restore.
- **R0-4:** Added `settingsDialogUi.test.ts` — null opener no-op, default/explicit tabs, re-register replaces opener.
- **R0-5:** Added `fileWatcher.test.ts` — `sync_file_watcher_paths` invoke args, `FILE_CHANGED_EVENT` constant.

## 2026-06-01 (R0-1, R0-2)

- **R0-1:** Added `openActivePath.test.ts` — gate redirect/existing, happy path, too_large, missing (recent prune), failed; `describeOpenActivePathResult` for all kinds.
- **R0-2:** Extracted `appShellHelpers.ts` (`watchedPathsFromState`, `formatStatusPath`, `canFitMarkdownSplit`, `computeResponsiveLayoutFlags`) with `appShellHelpers.test.ts`; `+page.svelte` imports helpers.

## 2026-06-01 21:45 (MSK)

- **Refactoring R0 spec:** Added `specs/refactoring-1/r0-execution-plan.md` (test baseline before refactors: `openActivePath`, shell helpers, `windowBounds`, `fileWatcher`, command handlers, optional coverage/component tests). Updated `refactoring-plan.md` and R1–R3 prerequisites so **R0 → R1 → R2 → R3**.

## 2026-06-01 21:30 (MSK)

- **Refactoring specs:** Added `specs/refactoring-1/refactoring-plan.md` (codebase review findings, target architecture, milestone overview) and execution plans `r1-execution-plan.md` (app shell decomposition), `r2-execution-plan.md` (state store splits), `r3-execution-plan.md` (provider abstraction and Svelte 5 polish).

## 2026-05-31 23:10 (MSK)

- **Architecture docs:** Added `docs/architecture.md` (app layering, state, persistence, Tauri role, agent conventions) and `docs/providers.md` (GLM provider integration, BigModel API used vs unused).

## 2026-05-31 22:35 (MSK)

- **Untitled document helpers:** Added `DEFAULT_UNTITLED_TITLE`, `isUnsavedDocument`, `isEmptyUnsavedDocument`, and `buildEmptyUnsavedDocument` to replace hardcoded `"Untitled"` title comparisons. Bootstrap window detection now uses empty unsaved document state instead of title string matching.

## 2026-05-31 22:15 (MSK)

- **Multi-window tab transfer:** Transferred tabs now replace the default bootstrap Untitled tab in a new window instead of opening beside it. Empty Untitled is still created only when a window would otherwise have no tabs.

## 2026-05-31 20:30 (MSK)

- **Multi-window tab transfer:** Added Tauri webview window creation permissions. Hardened `createNewWindowWithTransfer` with error handling, parent window placement, focus/show, and a ready handshake before emitting tab transfer events. Split tab transfer into non-destructive payload build + post-success removal via `tabWindowTransfer.ts`. Moved transfer listener early in app startup and added drag-out tear-off in TabBar.

## 2026-05-31 15:48 (MSK)

- **EX2-4 — Chat store model lifecycle:** Added `getActiveChatModel`, `switchThreadModel` (generation guards, `model-switched` system events, metadata persistence), and provider-switch model fallback via `resolveProviderSwitchModelId`. Extended `switchThreadProvider` to accept `providerModelCatalogs` and apply fallback policy.

- **EX2-5 — Chat UI model selector:** Added Model selector in `ChatPanel` composer (provider-scoped list from settings), disabled controls during generate/send/retry, and alarm-style blocked state for locally invalid models with Settings recovery action. Model switch events render in message history.

- **EX2-6 — Send pipeline model integration:** Send path resolves effective model from thread metadata + provider defaults, fails fast on local invalid model, and maps provider runtime model rejection to user-safe copy (wired in prior EX2-3; validated end-to-end).

- **EX2-8 — Validation and tests:** Extended tests for model switch events, provider-switch fallback, local invalid model block, adapter model propagation, and GLM runtime rejection. All 496 tests pass; `npm run check` clean.

## 2026-05-31 19:05 (MSK)

- **EX2-3 — Provider model contract and validation:** Extended `ProviderSendRequest` with resolved `modelId`, added `modelValidation` helpers for local catalog checks and provider-runtime rejection mapping, wired send validation to block invalid models before network calls, and updated GLM/Debug adapters to consume explicit model ids.

## 2026-05-31 18:10 (MSK)

- **EX2-2 — Provider model catalogs in settings:** Added provider-agnostic `providerModelCatalogs` (model list + default per provider) with persistence in `settings.json`, legacy GLM `modelId` migration, and shared Settings UI for editing GLM/Debug model lists and defaults.

## 2026-05-31 16:45 (MSK)

- **EX2-1 / EX2-7 — Model metadata and system events:** Extended `ChatThreadMetadata` with optional `selectedModelId` and `ChatSystemEvent` with `model-switched` payload. Updated chat persistence codecs for tolerant decode of legacy snapshots and round-trip of new fields/events.

## 2026-05-31 15:20 (MSK)

- **AI Extra 2 execution plan:** Added `specs/ai-m-extra-2-execution-plan.md` for generic per-agent model selection across all providers, including settings-managed provider model catalogs, model-switch system events, dual invalid-model blocking (local + provider-runtime), deterministic provider-switch model fallback, and validation task breakdown.

## 2026-05-30 (MSK)

- **Agent chat layout:** Title stays pinned at the top; blocked states, messages, and composer sit at the bottom so the conversation grows upward. Provider and mode controls moved to the composer row, to the right of Send.

- **Agent chat provider defaults:** New draft agents no longer trigger a false workspace-access warning when Debug is the effective provider. Provider dropdown and access preflight now share the same default resolution (GLM only when credentials are configured). Removed Cursor from the provider list. Workspace blocked-state copy is generic instead of always mentioning GLM setup.

- **Agents sidebar layout:** Moved the agents panel to sit immediately right of the activity rail (modes/workspaces bar). Project panel stays on the far right; agents sidebar resize handle and collapse direction updated for left-side placement.

- **Theme panel and settings layout:** Moved **Decorate plaintext symbols** into the theme pane **Appearance** section (below the heading, above built-in theme choices). Added a **Built-in themes** subheading before Amber/Blue. Moved **Hide activity rail when Notepad only** to Settings → Editor (**Layout**). Removed the theme pane **Decoration** section.

- **Tab context menu — Rename:** File tabs with a saved on-disk path expose **Rename** in the tab context menu; it renames the right-clicked tab’s file (not necessarily the selected tab). Hidden for agent, untitled, and missing-file tabs. **File → Rename** still targets the active tab.

- **Untitled save dialog suggestions:** Saving untitled files (Save, Save As, Save All) prefills the save dialog with the tab’s derived title (first non-empty line, same as the tab label) under the workspace root. Notepad leaves the save location to the OS. No default extension in v1.

- **Per-workspace panel layout persistence:** Project panel and agents sidebar widths and collapsed state are stored in each workspace's session snapshot (`session.layout`) and restored on app restart. Switching workspaces restores that workspace's individual layout. Removed window-global `editorPreferences.projectPanelCollapsed`.

- **Markdown view mode persistence:** Each markdown file remembers its edit/split/preview mode per document. Mode restores when switching tabs and is saved in the session snapshot between app restarts.

- **Markdown preview links:** External `http`/`https`/`mailto`/`tel` links open in the system browser via `tauri-plugin-opener`; relative and `file:` links resolve against the open markdown file and open in the editor. In-webview navigation is blocked on all markdown preview surfaces.

## 2026-05-28 22:30 (MSK)

- **M6-5 — AI chat MVP ship:** Ran full validation suite (`npm test` 436 tests, `npm run check` clean, `cargo test` 5 tests). Added `chatM6-5.validation.test.ts` covering M6 exit criteria — retry on Debug/GLM, streaming vs buffered fallback, recovery copy, compaction + delete agent, concurrent multi-agent generation. Updated README to reflect shipped MVP scope. Marked M6-5 complete in execution plan.
- **AI chat MVP ships at M6 completion.** Scope: workspace agents sidebar + agent tabs, Ask/Review modes, GLM production provider, Debug for development, retry, streaming fallback, error/recovery copy, retention compaction, delete agent. Known follow-ups: optional Cursor SDK (`specs/ai-m-extra-1-execution-plan.md`), agent list subtitles, custom modes.

## 2026-05-28 22:25 (MSK)

- **M6-4 — Edge-case UX polish:** Added workspace-scoped generation cancellation (`cancelAgentGeneration`, `cancelAllGenerations`) wired on workspace switch and agent tab close so `isGenerating` never sticks after transitions. Send pipeline updates and completes turns against the originating workspace root and stops cleanly when cancelled mid-stream. Provider switch clears failed-turn retry state. Review mode renders structured section headings for long responses; compaction banner copy/styling improved; agent tab layout stays scrollable at narrow widths with responsive panel/sidebar collapse. Added `chatReviewContent`, `chatM6-4.validation.test.ts`. Marked M6-4 complete in execution plan.

## 2026-05-28 22:20 (MSK)

- **M6-3 — Error copy and recovery guidance polish:** Centralized user-facing chat error copy in `chatErrorCopy.ts` for missing provider config, workspace access blocked, provider request failure, and mode/provider incompatibility. `ChatPanel` shows consistent titles, messages, and recovery hints (including Retry guidance for failed turns); Debug blocked state adds a settings CTA. Send pipeline sanitizes unexpected provider errors so raw stack traces never reach the UI. Updated GLM/Debug/capability checker and chatStore copy. Added `chatErrorCopy.test.ts`. Marked M6-3 complete in execution plan.

## 2026-05-28 22:05 (MSK)

- **M6-2 — Streaming response support:** Send pipeline uses `streamProviderMessage` to append partial assistant content via `chatStore.updateMessageContent` during generation and finalize on completion. Debug provider streams simulated chunks; GLM and other buffered-only providers fall back to `sendMessage` with a single content update. Persistence writes the final message once after the turn completes (no partial persist thrash). Added `chatSend.test.ts` for adapter streaming/fallback coverage and send-pipeline tests for persist-after-stream and GLM buffered fallback. Marked M6-2 complete in execution plan.

## 2026-05-28 22:00 (MSK)

- **M6-1 — Retry last turn:** Added `retryLastChatTurn()` to resend the last user message through the current provider without duplicating the user turn. Wired **Retry** in `ChatPanel` when a failed turn exists (disabled while generating). Successful retry clears failure runtime state and appends a system note preserving the previous error. Added retry pipeline unit tests for Debug and GLM paths. Marked M6-1 complete in execution plan.

## 2026-05-28 21:15 (MSK)

- **M5-3-3 — Milestone validation:** Added `chatM5-3.validation.test.ts` covering M5.3 exit criteria — Debug/GLM access preflight pass/fail, per-agent generation lock, concurrent Debug+GLM sends, streaming finalize, failure retry scaffolding, GLM review mode, provider switch persistence, and workspace access blocks. Documented manual smoke checklist and optional GLM integration env requirements. Ran `npm test` (410 tests) and `npm run check` (clean). Marked M5.3 execution plan complete.

## 2026-05-28 21:00 (MSK)

- **M5-3-2 — GLM provider adapter:** Added `GlmChatProvider` with OpenAI-compatible `/chat/completions` calls, shared prompt assembly (`buildGlmChatMessages`), capability checks, and user-facing `ChatProviderError` mapping. Registered GLM in provider bootstrap; capability checker delegates to the adapter when credentials are configured. Buffered send path only (streaming deferred to M7). Unit tests with mock fetch for adapter, registry checker, and send pipeline.

## 2026-05-28 20:12 (MSK)

- **M5-3-1 — GLM settings and config UI:** Added `GlmProviderSettings` (enabled, base URL, model ID) to persisted settings; API key stored separately in `glm-secrets.json` (never in `settings.json`, chat threads, or Debug diagnostics). New **GLM** tab in Settings; inline setup CTA in `ChatPanel` when GLM is selected but credentials are missing. Capability preflight and send pipeline block unconfigured GLM with actionable hints. Unit tests for settings normalization and secrets store.

## 2026-05-28 18:05 (MSK)

- **M5-2-8 — Milestone validation:** Added `chatM5-2.validation.test.ts` covering M5.2 exit criteria (draft lifecycle, parallel Debug generation, date grouping and title search, delete agent, session restore, close-tab navigation, console height-only prefs). Ran `npm test` (377 tests) and `npm run check` (clean). Marked M5.2 execution plan complete.

## 2026-05-28 17:30 (MSK)

- **M5-2-7 — Console logs-only:** Removed Chat tab from `ConsolePanel`; console shows `ConsoleLogsPanel` only. Dropped console chat tab preference persistence (`tabsByWorkspaceKey`, `ConsoleTabId`, workspace tab read/write). Removed `+page.svelte` wiring for console tab selection and chat-gated preflight on console tab. Access monitor comment updated for agent-tab context. Trimmed `consoleTabPrefs` tests to height persistence only.

## 2026-05-28 17:12 (MSK)

- **M5-2-6 — Session restore and sidebar ↔ tab sync:** Added `lastActiveAgentId` to workspace session state. On workspace enter, restore open agent tabs (including session-only drafts via `mergeSessionDraftAgents`), focus last active agent when it still exists, otherwise clear sidebar selection without auto-opening another. Close agent tab: next open agent tab in bar order, else next sidebar row (highlight only), else clear selection. `TabBar` uses `onCloseTab` for agent navigation. Unit tests for routing helpers, restore resolution, merge drafts, and close-tab order.

## 2026-05-28 17:05 (MSK)

- **M5-2-5 — Agent tabs and editor routing:** Agent tabs in `TabBar` use accent styling and titles from the workspace agent index. Editor pane shows `ChatPanel` when an agent tab is selected (file tabs unchanged). Chat access preflight and polling run on agent tab activation instead of the console Chat tab. Replaced “Clear workspace chat history” with **Delete agent** in chat chrome. Added `editorRouting.ts` unit tests.

## 2026-05-28 16:26 (MSK)

- **M5-2-4 — Agents sidebar UI:** Added `AgentsSidebar.svelte` (search, New agent, date-grouped list, selection highlight, delete via context menu, resize/collapse). Integrated into shell grid to the right of the project panel; hidden outside workspace context. Wired `openOrFocusAgentTab` / `closeTabsForAgent` in `appState` and sidebar handlers to `chatStore`. Added `chatAgentIndex` and `chatActiveAgentId` derived stores.

## 2026-05-28 16:16 (MSK)

- **M5-2-3 — Draft agent lifecycle:** Added `chatStore.createDraftAgent`, `isAgentDraft`, and `getAgentTitle`. Drafts live in the in-memory agent index only (no thread file) until the first user message; `appendMessage` and `sendChatMessage` promote the draft (title from first line, `isDraft` cleared, `lastUsedAt` updated). Persistence is skipped until a user message exists. Unit tests for multiple drafts, promotion, and first-send persist.

## 2026-05-28 15:56 (MSK)

- **M5-2-2 — chatStore per-agent refactor:** Refactored `chatStore` to `threadsByAgentId`, `runtimeByAgentId`, `activeAgentId`, and in-memory workspace agent index per root. Mutations, turn lifecycle, provider switch, and `deleteAgent` target agent id; generation lock is per agent. `sendChatMessage` accepts optional `agentId`. Removed `INTERIM_WORKSPACE_AGENT_ID` bridge. Added unit tests for parallel runtime, active-agent switching, and delete agent.

## 2026-05-28 15:25 (MSK)

- **M5-2-1 — Multi-agent contracts and persistence:** Added per-agent types (`AgentIndexEntry`, `WorkspaceAgentsIndexSnapshot`, `ChatAgentThreadFileSnapshot`), `agentId`/`threadId` on `ChatThreadMetadata`, and `TabState` discriminated union (`file` | `agent`). Replaced single workspace chat file with `chat/{hash}/index.json` plus per-agent `{agentId}.json` thread files. Added `chatAgents.ts` helpers (title derivation, date grouping). Updated persistence callers to use interim single-agent bridge until M5-2-2. Unit tests for title truncation, date grouping, index read/write, and per-agent thread read/write.

## 2026-05-28 14:30 (MSK)

- **AI agents pivot — specs:** Rewrote `specs/ai-requirements.md` for agents sidebar + agent tabs (multi-agent per workspace, draft-on-first-message lifecycle, delete agent, logs-only console). Split M5 execution plan into `specs/ai-m-5-1-execution-plan.md` (completed Debug/provider foundation), `specs/ai-m-5-2-execution-plan.md` (Agents UI shell, 8 tasks), and `specs/ai-m-5-3-execution-plan.md` (GLM in agent tabs). Removed `specs/ai-m-5-execution-plan.md`. Updated `specs/ai-m-6-execution-plan.md` and `specs/ai-m-7-execution-plan.md` for agent-tab UX. Updated README WIP roadmap.

## 2026-05-28 11:45 (MSK)

- **Build warnings:** Fixed Svelte a11y warnings in `FindReplacePanel.svelte` (use `<search>` with programmatic keydown) and `SettingsDialog.svelte` (`div` instead of `nav` for tablist). Split settings CSS into `settingsForm.css`, `settingsDialogForm.css`, and `themePaneForm.css` so scoped imports no longer report unused selectors.

## 2026-05-28 (release)

- **Version 0.2.0:** Bumped app version in `package.json`, `Cargo.toml`, and `tauri.conf.json`.

## 2026-05-28 09:15 (MSK)

- **Themes T5:** `cycleTheme` flips `dark-amber` ↔ `light-blue` by current `data-theme` mode (from built-in or custom); clears custom selection. Menu/command wiring unchanged (`Meta+Shift+T`, View → Cycle Theme). `settingsStore.test.ts` documents that theme tests live in `themeStore.test.ts`; legacy `theme` field still ignored on load.
- **Themes T6:** Scrollbar colors use CSS vars (`scrollbar-track`, `scrollbar-thumb`, `scrollbar-thumb-hover`) — 26 tokens total; customs can theme scrollbars. Unit tests green (`themes`, `themeStore`, `appState`, `settingsStore`). Manual checklist: clone from each built-in, edit bg/accent, restart persistence, delete custom, legacy `settings.json` `theme` → `theme.json` migration — verified via unit tests and code review.

## 2026-05-28 09:12 (MSK)

- **Themes T4:** Full `ThemePane.svelte` UI — built-in radios with accent swatches, **+ New theme**, scrollable **Your themes** custom list, rename/delete controls, grouped token editor (color picker + CSS text field per token, all 23 keys); shared button/token row styles in `settingsForm.css`.

## 2026-05-28 09:10 (MSK)

- **Themes T3:** App state theme APIs and startup wiring — `AppThemeState` on domain state (`activeTheme`, `customThemes`); `setActiveTheme`, `createCustomTheme`, `renameCustomTheme`, `deleteCustomTheme`, `updateCustomThemeToken` (debounced save); `loadTheme()` at startup from `theme.json`; save-failure toast via `setThemeSaveErrorNotifier`; removed `theme` from `settings.json` / `PersistedSettings`; updated `ThemePane`, `+page.svelte`, and tests.

## 2026-05-28 09:05 (MSK)

- **Themes T2:** Added `themeStore.ts` and `themeStore.test.ts` — `theme.json` v1 schema (`activeTheme`, `customThemes`), load/save with token normalization (all 23 keys), one-time migration from `settings.json` when `theme.json` is missing (`dark-*` → `dark-amber`, `light-*` → `light-blue`).

## 2026-05-28 09:00 (MSK)

- **Themes T1:** Added `app/src/lib/styles/themeTokens.ts` — 23-token catalog with labels/groups, two built-ins (`dark-amber`, `light-blue`), `resolveBuiltinTokens`, `applyBuiltinTheme`, `applyCustomTheme`, `clearThemeOverrides`, `snapshotThemeTokens`, and legacy theme id normalization. Refactored `themes.ts` to thin re-exports; expanded `themes.test.ts`. Default persisted theme is `dark-amber`; settings load maps legacy `dark-*` / `light-*` ids to built-ins.

## 2026-05-27 24:00 (MSK)

- **Themes execution plan:** Added `specs/themes-execution-plan.md` (tasks T1–T6) from `specs/themes-plan.md` with all recommended clarification answers locked.

## 2026-05-27 23:45 (MSK)

- **Themes plan:** Added `specs/themes-plan.md` — two built-in themes, full-token custom themes, `theme.json` persistence, ThemePane UX, implementation checklist, and numbered clarification questions.

## 2026-05-27 23:00 (MSK)

- **Markdown split view:** Fixed post-scroll drift by syncing only user-initiated scroll events (`isTrusted`); programmatic sync no longer bounces between editor and preview panes.

## 2026-05-27 22:30 (MSK)

- **README:** Removed all references to `specs/` and internal milestone IDs; WIP roadmap rewritten in plain product terms.

## 2026-05-27 22:15 (MSK)

- **README:** Reframed SpecOps as a workspace-oriented desktop app (notepad, project panel, workspaces, console). Added main-screen screenshot, app icon in title, current-features list, and WIP roadmap from `specs/ai-requirements.md`.

## 2026-05-27 (fix)

- **Fix Debug provider preflight:** `chatStore.getActiveChatProvider()` resolves thread provider or bootstrap default; preflight and send pipeline no longer fall back to hardcoded `glm` when thread metadata is missing. `ChatPanel` re-runs access preflight when effective provider or Debug settings change; provider/mode pickers stay enabled while blocked so users can switch to Debug.

## 2026-05-27 21:00 (MSK)

- **Settings dialog:** Initial size measured to fit **Debug AI** without scrolling; tab switches keep fixed dimensions; bottom-right resize with min size equal to initial measured width/height; body scrolls only when content overflows after resize.

## 2026-05-27 20:35 (MSK)

- **Settings dialog:** Renamed **AI** tab to **Debug AI** (Debug provider settings only). Tabs moved to a fixed-width left sidebar column; panel content scrolls on the right.

## 2026-05-27 19:15 (MSK)

- **Settings split:** Toolbar **Theme** button opens a scrollable side pane (themes + decoration only). Full **Settings** dialog with **Editor** and **AI** tabs opens from **SpecOps → Settings** (macOS), **File → Settings…** (Windows/Linux), and `Cmd/Ctrl+,`.
- **Components:** Added `ThemePane.svelte`, `SettingsDialog.svelte`, and shared `settingsForm.css`.

## 2026-05-27 18:30 (MSK)

- **Console UX:** Vertically resizable console (drag handle, double-click reset, height persisted in `console-tab-prefs.json`). Console and status bar moved into the editor column so chat aligns with the text area; shared `--editor-content-padding-x` with the editor pane.
- **Chat UX:** Grid layout fixes mode/provider chrome clipping; provider picker is a dropdown; empty-state copy updated.
- **Debug provider:** Enabled by default in `defaultDebugProviderSettings` for dogfooding.
- **Branding:** User-visible app name unified to **SpecOps** (window title, About menu, Tauri `productName`, web title, release name).
- **Activity rail:** Fast custom `HoverTooltip` (folder name + full path) on workspace and rail buttons.

## 2026-05-27 17:10 (MSK)

- **App icon:** Replaced the orange spec-ops icon with the cyan variant from `spec-ops-cyan-app-icon.png`. Source glyph upscaled (LANCZOS) onto a 1024×1024 transparent canvas at the same ~86.5% fill ratio as the previous icon so macOS dock size stays consistent. Regenerated all Tauri bundle icons (`icon.icns`, `icon.ico`, platform PNGs) and updated `app/static/favicon.png`.

## 2026-05-26 21:50 (MSK)

- **AI M5-6 provider/mode selection UI:** Added provider picker to `ChatPanel.svelte` with Debug gated by Developer Settings; mode options filter by active provider capabilities; provider/mode controls disable while generating.
- **Provider selection helpers:** Added `app/src/lib/ai/providers/selection.ts` with selectable provider list, default precedence (GLM when configured → Debug when enabled → GLM fallback), and switch notice formatting.
- **AI M5-7 provider switch events:** Added `chatStore.switchThreadProvider()` to persist provider metadata, append `provider-switched` system messages, block Debug when disabled, and prevent switches during generation; distinct system-event rendering in chat history.
- **Bootstrap:** Wired default new-thread provider resolver via `setDefaultChatProviderResolver()`.
- **Tests:** Added `selection.test.ts` and `chatStore` provider-switch coverage; full `npm test` (304 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M5-6` and `Task M5-7` as done in `specs/ai-m-5-execution-plan.md`.

## 2026-05-26 21:41 (MSK)

- **AI M5-5 chat send pipeline:** Added `sendChatMessage()` orchestrating access preflight, user append, `beginTurn()`, provider streaming/buffered send, incremental assistant updates, `completeTurn()` / `failTurn()`, post-turn compaction, and single persist per completed turn.
- **Chat store streaming support:** Added `updateMessageContent()`, `removeMessage()`, `compactActiveThread()`, and `skipCompaction` option on `appendMessage()` for streaming without partial persist thrash.
- **Chat UI:** Wired `ChatPanel` to the send pipeline; composer disables while generating; streaming assistant placeholder/partial content visible; inline error on failure (retry deferred to M7).
- **Tests:** Added `sendChatMessage.test.ts` covering Debug ask/review E2E, streaming partial updates, generation lock, failure scaffolding, and preflight blocking; full `npm test` (297 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M5-5` as done in `specs/ai-m-5-execution-plan.md`.

## 2026-05-26 21:34 (MSK)

- **AI M5-4 Debug provider adapter:** Added `DebugChatProvider` with settings-gated `checkCapabilities()`, seeded simulation (`debugSimulation.ts`), structured ask/review responses, optional diagnostics appendix, buffered `sendMessage()`, and chunked `streamMessage()` with configurable delay/failure.
- **Provider bootstrap:** Added registry-backed capability checker (`capabilityChecker.ts`), provider registration/bootstrap wired at app startup, and `streamProviderMessage()` helper in `chatSend.ts` for send-pipeline integration (M5-5).
- **Errors:** Added `ChatProviderError` for simulated provider failures mapped to `failTurn` scaffolding.
- **Tests:** Added `debugChatProvider.test.ts` and `capabilityChecker.test.ts` covering deterministic seeded simulation, review template shape, diagnostics toggle, streaming chunks, and failTurn wiring; full `npm test` (291 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M5-4` as done in `specs/ai-m-5-execution-plan.md`.

## 2026-05-26 21:15 (MSK)

- **AI M5-3 Developer Settings:** Added `DebugProviderSettings` to persisted settings and `AppSettingsState` with safe defaults (`enabled: false`, `failureProbability: 0`); validation/clamping via `normalizeDebugProviderSettings()` on load/save.
- **Developer Settings UI:** Added grouped Debug provider section in settings pane (Enable · Simulation · Output) with seed, delay/chunk ranges, failure probability/message, and diagnostics toggle.
- **Debug send blocking:** When thread metadata has `provider: "debug"` but Debug is disabled, chat send is blocked with a recovery hint pointing to Developer Settings (no auto-switch).
- **Tests:** Added `debugProviderSettings.test.ts` and extended `settingsStore.test.ts` for defaults, range normalization, and send-block helpers; full `npm test` (278 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M5-3` as done in `specs/ai-m-5-execution-plan.md`.

## 2026-05-26 21:11 (MSK)

- **AI M5-2 built-in modes:** Added `app/src/lib/ai/modes/builtins.ts` with `ask` and `review` system prompt templates, mode registry (`id`, `label`, `outputStyle`), review section requirements, and T-shirt size + confidence wording enforcement.
- **Shared prompt assembly:** Added `app/src/lib/ai/modes/prompt.ts` with `buildThreadProviderRequest()` so Debug diagnostics and GLM adapter input share identical mode-aware payloads from M5-1 helpers.
- **Chat UI:** Wired segmented Ask/Review mode control in `ChatPanel.svelte`; selection persists via thread metadata and disables while generating.
- **Chat store:** `updateThreadMetadata()` now creates an empty thread when mode is selected before the first message.
- **Tests:** Added `builtins.test.ts` for mode registry and prompt assembly; extended `chatStore.test.ts` for pre-message mode persistence; full `npm test` (268 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M5-2` as done in `specs/ai-m-5-execution-plan.md`.

## 2026-05-26 20:59 (MSK)

- **AI M5-1 provider abstraction:** Added `app/src/lib/ai/providers/types.ts` with `ChatProvider` contract (buffered `sendMessage`, optional `streamMessage`, `checkCapabilities`), request/response DTOs, and shared `buildProviderRequest()` / `buildProviderRequestFromThread()` for mode-aware prompt payload assembly.
- **Provider registry:** Added `app/src/lib/ai/providers/registry.ts` for register/resolve/list of active providers.
- **Debug provider id:** Extended `ChatProviderId` with `"debug"` and `PRODUCT_CHAT_PROVIDER_IDS`; updated chat persistence validation.
- **Tests:** Added `providers.test.ts` with in-memory test double covering buffered/streaming paths and registry resolution; full `npm test` (260 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M5-1` as done in `specs/ai-m-5-execution-plan.md`.

## 2026-05-26 (planning)

- **AI M5 execution plan rewrite:** Reordered `specs/ai-m-5-execution-plan.md` so Debug provider ships before GLM. Added Developer Settings (`DebugProviderSettings`), streaming simulation (random delay + chunked tokens), structured review templates, diagnostics appendix, and failure probability. Expanded to 10 tasks (M5-1–M5-10); GLM settings/adapter moved to M5-8/M5-9; milestone validation to M5-10. Updated Milestone 5 summary in `specs/ai-requirements.md`.

## 2026-05-26 17:42 (MSK)

- **AI M4-7 milestone validation:** Added `app/src/lib/state/chatM4.validation.test.ts` covering M4 exit criteria: FIFO cap overflow bounds, compaction summary/metadata updates, prompt-context shape, clear-history isolation, and retry scaffolding without provider coupling.
- **Validation run:** Full `npm test` (31 files, 251 tests passed) and `npm run check` (0 errors; 1 pre-existing `FindReplacePanel.svelte` a11y warning unchanged).
- **Manual smoke checklist (M4 exit):**
  - Long conversation append triggers FIFO compaction; compaction banner shows compacted message count.
  - Clear workspace chat history returns to empty state and persists after restart.
  - Retry hooks (`beginTurn` / `failTurn` / `canRetryLastTurn`) available without provider integration.
- **Specs tracking:** Marked `Task M4-7` as done in `specs/ai-m-4-execution-plan.md`. Milestone 4 complete.

## 2026-05-26 17:45 (MSK)

- **AI M4-5 retry scaffolding:** Added per-workspace ephemeral runtime state in `chatStore` (`isGenerating`, `lastFailedTurnId`, `lastError`) with provider hooks `beginTurn()`, `completeTurn()`, `failTurn()`, and `canRetryLastTurn()`; runtime resets on clear history.
- **AI M4-6 compaction indicator:** Added persistent thread banner in `ChatPanel.svelte` when `compactedMessageCount > 0`, using `formatCompactionNotice()` copy (e.g. "24 older messages compacted").
- **Tests:** Added chatStore turn lifecycle, workspace-scoped failure retention, clear-reset, and compaction notice formatting coverage; full `npm test` and `npm run check` pass.
- **Specs tracking:** Marked `Task M4-5` and `Task M4-6` as done in `specs/ai-m-4-execution-plan.md`.

## 2026-05-26 17:34 (MSK)

- **AI M4-3 compaction summary:** Extended `ChatThreadMetadata` with `compactionCount`, `lastCompactedAt`, and `compactedMessageCount`; on FIFO truncation, `compactChatThread()` now appends structured user/assistant bullet summaries and updates compaction metadata.
- **Prompt context helper:** Added `buildThreadPromptContext()` in `chatRetention.ts` for future M5 prompt assembly (summary + recent messages).
- **AI M4-4 clear history:** Added `clearWorkspaceChatFileSnapshot()` and `chatStore.clearActiveWorkspaceChatHistory()` to reset in-memory thread and persist an empty workspace chat file; added confirm-gated "Clear workspace chat history" action in `ChatPanel.svelte`.
- **Tests:** Added summary append, clear/idempotency, and workspace-isolation coverage in `chatRetention.test.ts`, `chatPersistence.test.ts`, and `chatStore.test.ts`; full `npm test` (241 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M4-3` and `Task M4-4` as done in `specs/ai-m-4-execution-plan.md`.

## 2026-05-26 14:43 (MSK)

- **AI M4-1 retention policy:** Added `CHAT_RETENTION_MAX_TURNS` (50), `countConversationTurns()`, and `needsChatCompaction()` in `app/src/lib/services/chatPersistence.ts` with policy comments cross-referencing `specs/ai-requirements.md`.
- **AI M4-2 FIFO compaction:** Added `app/src/lib/services/chatRetention.ts` with turn-based FIFO truncation (oldest user/assistant turns and plain system notices droppable; provider `systemEvent` markers preserved); wired compaction into `chatStore.appendMessage()` after each append.
- **Tests:** Added `chatPersistence.retention.test.ts`, `chatRetention.test.ts`, and chatStore compaction integration coverage; full `npm test` (233 passed) and `npm run check` pass.
- **Specs tracking:** Marked `Task M4-1` and `Task M4-2` as done in `specs/ai-m-4-execution-plan.md`.

## 2026-05-26 14:15 (MSK)

- **AI M3-5 mid-session access loss:** Extended `chatStore.runAccessPreflight()` to detect `ready` → `blocked` transitions for `workspace_path_inaccessible`, append a system message in the active thread, and reject further user sends while blocked without clearing history.
- **Access monitoring:** Added `chatAccessMonitor.ts` with conservative Chat-tab polling (`15s`) and wired `+page.svelte` to start/stop monitoring when the console Chat tab is active; project-tree root reload probes inaccessible roots and re-runs preflight.
- **Lightweight probe:** Added `probeWorkspaceReadAccess()` in `fileSystem.ts` (readDir-only, no persistence) for FS hooks and tree refresh triggers.
- **AI M3-6 validation:** Added `capabilities.test.ts`, `chatAccessMonitor.test.ts`, expanded `chatStore.test.ts` and `fileSystem.test.ts` for access-loss transitions; full `npm test` and `npm run check` pass.
- **Manual smoke (M3 exit):** Accessible workspace shows blocked composer with stub checker; simulated inaccessible root blocks sends, keeps history read-only, shows recovery banner + system loss message after prior ready state.
- **Specs tracking:** Marked `Task M3-5` and `Task M3-6` as done in `specs/ai-m-3-execution-plan.md`.

## 2026-05-26 13:32 (MSK)

- **AI M3-4 blocked chat UI:** Updated `app/src/lib/components/ChatPanel.svelte` to consume reactive `chatAccessState`, disable composer/send when access is blocked, and render a visible inline blocked-state message (`AI cannot read files in this workspace`) with reason-specific copy and recovery guidance.
- **Reason-aware messaging:** Added blocked-state message mapping for `workspace_path_inaccessible`, `missing_provider_config`, and `provider_unsupported`, with fallback text for unknown blocked cases.
- **Behavior gating:** `submitMessage` now hard-blocks sends while access is blocked, and textarea/button disabled state follows blocked state directly.
- **Tests:** Added `app/src/lib/components/ChatPanel.test.ts` covering blocked-state disablement/message visibility and ready-state composer enablement.
- **Specs tracking:** Marked `Task M3-4` as done in `specs/ai-m-3-execution-plan.md`.

## 2026-05-26 13:05 (MSK)

- **AI M3-3 preflight orchestrator:** Extended `app/src/lib/state/chatStore.ts` with runtime access preflight orchestration (`runAccessPreflight`) that composes workspace access checks (`ensureWorkspaceReadAccess`) with provider capability checks and stores per-workspace chat access outcomes.
- **Stub capability checker:** Added a deterministic built-in capability checker fallback in `chatStore` that returns a blocked `provider_unsupported` state until real provider integrations land, while preserving `setCapabilityChecker` for future real provider wiring.
- **Reactive access state:** Added `ChatAccessState` and reactive `chatAccessState` export in `chatStore` plus imperative `getChatAccessState()` for UI consumption and upcoming blocked-state UX wiring.
- **Preflight triggers:** Updated `app/src/routes/+page.svelte` to run chat preflight on workspace activation, on Chat tab selection, and when opening the console directly into Chat.
- **Tests:** Expanded `app/src/lib/state/chatStore.test.ts` with M3-3 coverage for blocked workspace-path preflight and deterministic stub-checker blocked preflight behavior.
- **Specs tracking:** Marked `Task M3-3` as done in `specs/ai-m-3-execution-plan.md`.

## 2026-05-26 09:45 (MSK)

- **AI M3-2 workspace access preparation:** Added `ensureWorkspaceReadAccess(rootPath)` and access snapshot persistence in `app/src/lib/services/fileSystem.ts`; successful checks return `ready`, inaccessible roots return `blocked`, and diagnostics are emitted via `logDiagnostic`.
- **Allowed roots persistence:** Added `workspace-access.json` handling in app data (`readAllowedWorkspaceRoots`, internal read/write helpers) to persist normalized workspace roots that pass read-access preparation.
- **Workspace add/open wiring:** Updated `workspace.add` command in `app/src/lib/commands/registry.ts` to enforce access preparation before adding a workspace and show actionable blocked messaging; updated `app/src/routes/+page.svelte` to run access preparation on restored workspace activation and workspace switch.
- **Tests:** Extended `app/src/lib/services/fileSystem.test.ts` and `app/src/lib/commands/registry.test.ts` to cover ready/blocked access checks, diagnostics logging on failure, persisted allowed roots parsing, and blocked workspace-add flow.
- **Specs tracking:** Marked `Task M3-2` as done in `specs/ai-m-3-execution-plan.md`.

## 2026-05-26 09:13 (MSK)

- **AI M3-1 capability contract:** Added provider-agnostic capability types and checker interface in `app/src/lib/ai/capabilities.ts`: `WorkspaceAccessStatus`, `WorkspaceAccessReason` codes (`missing_provider_config`, `workspace_path_inaccessible`, `provider_unsupported`), `ProviderCapabilities`, `CapabilityCheckResult`, and `CapabilityChecker`.
- **Chat runtime preflight import point:** Updated `app/src/lib/state/chatStore.ts` to import and use the capability contract via `setCapabilityChecker(...)` and `checkActiveWorkspaceCapabilities()`, making capability checks callable from chat runtime flow.
- **Tests:** Extended `app/src/lib/state/chatStore.test.ts` with coverage for unknown-state fallback and configured checker invocation/return path.
- **Specs tracking:** Marked `Task M3-1` as done in `specs/ai-m-3-execution-plan.md`.

## 2026-05-25 23:20 (MSK)

- **AI M2-6 milestone validation:** Completed full Milestone 2 validation run in `app` with `npm test` (26 files, 208 tests passed) and `npm run check` (0 errors; 1 pre-existing `FindReplacePanel.svelte` a11y warning unchanged).
- **M2 coverage status:** Added/validated dedicated tests for codec + store + workspace isolation (`chatPersistence.test.ts`, `chatStore.test.ts`) and confirmed M2-2..M2-5 acceptance behavior remains green in the full suite.
- **Manual smoke checklist (M2 exit criteria):**
  - Workspace A/B context switch restores workspace-specific chat thread.
  - App restart restores active workspace and its chat metadata/messages from per-workspace chat file.
  - Workspace with no chat file shows empty `Start chat` state until first user message.
  - Notepad context clears chat binding and does not display prior workspace messages.
- **Specs tracking:** Marked `Task M2-6` as done in `specs/ai-m-2-execution-plan.md`.

## 2026-05-25 23:22 (MSK)

- **AI M2-5 chat conversation UI:** Replaced the `ChatPanel` placeholder with a functional pre-provider conversation UI in `app/src/lib/components/ChatPanel.svelte`, including message list rendering, role labels/styles (`user`/`assistant`/`system`), empty-state copy (`Start chat`), and composer controls.
- **Local message send flow:** Wired composer submit (Enter to send, Shift+Enter newline, send button) to `chatStore.appendMessage(...)`, with lazy-thread creation on first user message and immediate in-memory list updates in the active workspace chat tab.
- **Persistence on send:** Added chat snapshot persistence on successful local send via `scheduleWorkspaceChatFilePersistence(...)`, using active workspace/thread snapshots from `chatStore`.
- **Store selector support:** Extended `app/src/lib/state/chatStore.ts` with `getActiveWorkspaceRoot()` and `getActiveThreadSnapshot()` to provide safe, encapsulated persistence inputs for the UI layer.
- **Svelte validation:** Ran `npx @sveltejs/mcp svelte-autofixer ./src/lib/components/ChatPanel.svelte` (clean) and kept runes-mode reactivity (`$derived`) for template state.
- **Specs tracking:** Marked `Task M2-5` as done in `specs/ai-m-2-execution-plan.md`.

## 2026-05-25 23:19 (MSK)

- **ChatPanel Svelte 5 runes fix:** Updated `app/src/lib/components/ChatPanel.svelte` to replace legacy `$:` reactive statements with rune-safe `$derived(...)` declarations for `messages`, `isEmpty`, and `isSendDisabled`.
- **Composer accessibility/idioms:** Added `aria-label` on the chat textarea and reused derived disabled-state logic for the send button while preserving existing Enter-to-send behavior and keyed message rendering.
- **Validation:** Ran Svelte MCP `svelte-autofixer` before/after edits; initial run flagged legacy reactive statements, final run returned clean (`issues: []`).

## 2026-05-25 23:17 (MSK)

- **AI M2-4 workspace chat restore wiring:** Integrated `chatStore` into `app/src/routes/+page.svelte` context flow so chat binding follows active workspace context and clears in Notepad context.
- **Workspace switch loading:** Added workspace-root keyed chat load on context changes; each new active workspace now loads its persisted thread snapshot (or `null` empty state) and sets it as active without leaking previous workspace messages.
- **Restart restore behavior:** Extended runtime setup after `restoreWindowSession` to initialize `chatStore` for the restored active workspace and hydrate persisted thread data during startup.
- **Race-safe store behavior:** Updated `app/src/lib/state/chatStore.ts` so `loadWorkspaceThread` only updates thread cache and does not mutate active workspace binding, preventing stale async loads from overriding the current workspace selection.
- **Tests:** Extended `app/src/lib/state/chatStore.test.ts` with workspace-empty-state and Notepad unbinding coverage, and updated workspace-switch test to reflect explicit active-workspace binding.
- **Specs tracking:** Marked `Task M2-4` as done in `specs/ai-m-2-execution-plan.md`.

## 2026-05-25 23:09 (MSK)

- **AI M2-3 chat in-memory store:** Added `app/src/lib/state/chatStore.ts` to manage one active workspace thread with per-workspace in-memory map, explicit workspace loading (`loadWorkspaceThread`), message appends, and thread metadata updates.
- **Lazy thread creation:** Implemented first-message creation semantics in `appendMessage` (creates thread only on first `user` message), with default metadata placeholders for MVP (`mode: ask`, `provider: glm`) and timestamp updates on append/update.
- **UI selectors:** Exposed both imperative selectors (`getMessages`, `getMetadata`, `hasThread`, `isEmpty`) and derived stores (`chatMessages`, `chatMetadata`, `chatHasThread`, `chatIsEmpty`) for upcoming ChatPanel wiring.
- **Tests:** Added `app/src/lib/state/chatStore.test.ts` covering lazy thread creation, append + metadata update behavior, and workspace-key switching that swaps active thread state.
- **Specs tracking:** Marked `Task M2-3` as done in `specs/ai-m-2-execution-plan.md`.

## 2026-05-25 22:59 (MSK)

- **AI M2-2 chat persistence service:** Added `app/src/lib/services/chatPersistence.ts` with workspace-scoped chat file mapping (`getWorkspaceChatFilePath`) under app data `chat/<normalized-path-hash>.json`, using normalized workspace path hash keys.
- **Versioned codec + safe fallbacks:** Implemented `encodeChatThreadFileSnapshot`/`decodeChatThreadFileSnapshot` with `version: 1` envelope handling and strict shape parsing for metadata/messages/system events; missing/corrupt/invalid content now safely resolves to an empty snapshot (`thread: null`) instead of throwing.
- **Debounced persistence helper:** Added `scheduleWorkspaceChatFilePersistence` (session-manager-style debounce) plus `resetChatPersistenceForTests` for deterministic unit tests.
- **Tests:** Added `app/src/lib/services/chatPersistence.test.ts` covering snapshot round-trip codec behavior, corrupt-file fallback, and distinct file mapping for different workspace paths.
- **Specs tracking:** Marked `Task M2-2` as done in `specs/ai-m-2-execution-plan.md`.

## 2026-05-25 22:55 (MSK)

- **AI M2-1 chat contracts:** Added chat domain contracts in `app/src/lib/domain/contracts.ts` for Milestone 2 storage/modeling: `ChatMessageRole`, `ChatMessage`, `ChatModeId`, `ChatProviderId`, `ChatThreadMetadata`, `ChatThreadSnapshot`, and `ChatThreadFileSnapshot` (versioned envelope).
- **System-event forward compatibility:** Added typed `ChatSystemEvent` support on `ChatMessage` to represent persisted system markers (starting with `provider-switched`) so provider-switch events can be appended as visible chat history entries in later milestones.
- **One-thread invariant documentation:** Documented one-thread-per-workspace invariant directly in `ChatThreadSnapshot` / `ChatThreadFileSnapshot` comments.
- **Specs tracking:** Marked `Task M2-1` as done in `specs/ai-m-2-execution-plan.md`.

## 2026-05-25 22:35 (MSK)

- **Console M1-5 context-switch integration:** Verified `app/src/routes/+page.svelte` still closes console on every Notepad/workspace context switch via `handleActiveContextSwitch`, while preserving M1-4 restore behavior for workspace tab preference on reopen.
- **Console reopen restore:** Confirmed console mounts with controlled `activeTab` from per-workspace prefs (`consoleTabSelection`) and keeps Notepad behavior prefs-free (no workspace read/write in Notepad context).
- **Validation:** Ran full suite in `app` — `npm test` (24 files, 200 tests passed) and `npm run check` (0 errors; one pre-existing `FindReplacePanel.svelte` a11y warning).
- **Specs:** Marked Task M1-5 as done in `specs/ai-m-1-execution-plan.md`.

## 2026-05-25 22:29 (MSK)

- **Console M1-4 persistence service:** Added `app/src/lib/services/consoleTabPrefs.ts` with lightweight app-data storage (`console-tab-prefs.json`) for per-workspace console tab selection, keyed by normalized workspace path hash and scoped to `chat`/`logs`.
- **Console tab restore wiring:** Updated `app/src/routes/+page.svelte` to restore tab preference when workspace context activates (default `chat` when no record exists), and persist changes only in workspace context.
- **Console panel control hook:** Updated `app/src/lib/components/ConsolePanel.svelte` to accept controlled `activeTab` and emit `onTabChange` callbacks while preserving existing M1-2 notepad gating and logs-only fallback behavior.
- **Tests:** Added `app/src/lib/services/consoleTabPrefs.test.ts` for hash-key stability and prefs read/write behavior.
- **Specs:** Marked Task M1-4 as done in `specs/ai-m-1-execution-plan.md`.
- **Validation:** Ran `npm run check`, `npm test -- consoleTabPrefs`, and `ReadLints` on changed files (no new errors; one pre-existing `FindReplacePanel.svelte` warning remains).

## 2026-05-25 22:13 (MSK)

- **Console M1-3 chat placeholder component:** Added `app/src/lib/components/ChatPanel.svelte` as a workspace-scoped empty-state view (`Start chat` with a brief workspace/provider hint) using existing console design tokens and without composer/input/network/provider runtime logic.
- **Console panel integration:** Updated `app/src/lib/components/ConsolePanel.svelte` to import/render `ChatPanel` instead of inline placeholder markup, preserving tab order (`Chat`, then `Logs`), current logs behavior, and existing `showChatTab` gating (tabs hidden in Notepad mode, logs-only when chat unavailable).
- **Validation:** Ran Svelte MCP `svelte-autofixer` for both changed components; fixed one a11y issue (`tabpanel` role on non-interactive element in `ChatPanel`) and revalidated cleanly (remaining `activeTab` `$effect` note in `ConsolePanel` is pre-existing M1-2 gating logic).

## 2026-05-25 21:56 (MSK)

- **Console M1-2 workspace gating:** Updated `app/src/lib/components/ConsolePanel.svelte` to accept `showChatTab`, hide the tab header in Notepad mode, and render logs-only when no workspace is active.
- **Console tab safety:** Added defensive tab coercion in `ConsolePanel.svelte` so hidden `Chat` cannot stay selected; panel falls back to `logs` when `showChatTab` is false.
- **Shell integration:** Updated `app/src/routes/+page.svelte` to pass `showChatTab={Boolean(activeWorkspaceRoot)}` into `ConsolePanel` while keeping existing `toggleConsole`, `applyResponsiveLayoutRules`, and context-switch close behavior unchanged.
- **Specs:** Marked Task M1-2 as done in `specs/ai-m-1-execution-plan.md`.
- **Validation:** Ran `npm run check` in `app` and `ReadLints` on changed files; no new errors (pre-existing `FindReplacePanel.svelte` a11y warning remains).

## 2026-05-25 21:43 (MSK)

- **Console M1-1:** Refactored `app/src/lib/components/ConsolePanel.svelte` into a tabbed console shell with `Chat` first and `Logs` second, defaulting to `Chat`, and added token-driven active/inactive tab states without changing console container sizing.
- **Console logs extraction:** Added `app/src/lib/components/ConsoleLogsPanel.svelte` and moved logs rendering logic there while preserving pre-refactor behavior (250-entry cap, truncation notice, sticky near-bottom autoscroll, line wrapping, and severity coloring).
- **Specs:** Marked Task M1-1 as done in `specs/ai-m-1-execution-plan.md`.
- **Validation:** Ran `npm run check` in `app`; passed with one pre-existing warning in `app/src/lib/components/FindReplacePanel.svelte` and no new errors.

## 2026-05-25

- **Console M1-1 follow-up:** Kept `app/src/lib/components/ConsoleLogsPanel.svelte` behavior identical while switching log consumption to direct `$consoleLogs` derived state in runes mode; retained 250-entry cap, truncation notice, sticky near-bottom autoscroll, and existing level colors/typography.
- **Console M1-1 tab shell:** Refactored logs rendering from `app/src/lib/components/ConsolePanel.svelte` into new `app/src/lib/components/ConsoleLogsPanel.svelte` with unchanged behavior (subscription to `consoleLogs`, max 250 visible entries, truncation notice, stick-to-bottom scrolling, preserved line formatting and severity colors).
- **Console tabs:** Updated `ConsolePanel.svelte` into a local-state tab shell with **Chat** then **Logs** order (default **Chat**), a simple `Start chat` placeholder panel, and conditional rendering of `ConsoleLogsPanel` for logs while preserving existing console height and border structure.
- **Validation:** Verified updated Svelte components with `@sveltejs/mcp` autofixer and workspace lints; resolved runes-mode reactivity issues by using `$state` and runes-safe effects.

- **Tabs:** Hide **Copy Relative Path** in Notepad mode (workspace context menu only).
- **Settings:** Fix theme not surviving restarts — load persisted settings before session restore, preserve settings (including theme) in `applyWindowSession`, and defer settings persistence until runtime is ready so startup session restore cannot overwrite `settings.json` with defaults.
- **Open Nearby:** Align nearby file filtering with `isOpenableFilePath` (syntax-highlighted extensions, known extensionless names, and plain extensionless notes) instead of only `.txt`/`.md`/`.markdown`. Log a diagnostic warning when nearby directory reads fail instead of failing silently.
- **Tabs:** Add **Copy Path** and **Copy Relative Path** (workspace tabs only) to the tab context menu.
- **Editor:** Use static imports for CodeMirror JS, HTML, and CSS language packs in `editorLanguage.ts`. These modules were already bundled via `@codemirror/lang-markdown`; dynamic `import()` only produced Vite warnings without code-splitting benefit. Synchronous `getLanguageSupport` now covers those languages for immediate highlighting on first open.
- **Specs:** Add `specs/ai-questions.md` documenting AI chat-in-console MVP idea, confirmed decisions (workspace-scoped history, auto-load last thread on switch), and a numbered clarification checklist with recommended options for console behavior, thread model, modes, providers, persistence, error UX, and future settings-driven mode extensibility.
- **Specs:** Update `specs/ai-questions.md` to replace `plan` mode with `review`, redefine mode expectations toward critique/estimation/clarification behavior, and add new mode-specific open questions for minimum `review` behavior and default effort-estimation output.
- **Specs:** Promote `specs/ai-requirements.md` as source of truth for AI chat in workspaces, including finalized behavior for console tabs, workspace-scoped chat, `ask`/`review` modes, provider switching semantics, mandatory workspace file-access preflight with blocking UX, persistence/retention rules, and milestone-based implementation plan. Update `specs/ai-questions.md` as historical discussion with a source-of-truth pointer and additional captured decisions on file-access gating and no active-file/log attachment in MVP.
- **Specs:** Split provider/runtime implementation milestone in `specs/ai-requirements.md` into two sequential milestones: GLM integration first, Cursor SDK integration second. Renumber subsequent milestones accordingly (`Access contract` to Milestone 5, `Retention/reliability/polish` to Milestone 6).
- **Specs:** Reorder `specs/ai-requirements.md` milestones so platform substrate precedes provider integration: access contract (M3), retention/reliability core (M4), then GLM (M5) and Cursor SDK (M6), with retry/streaming/UX polish last (M7).
- **Specs:** Add per-milestone AI execution plans (`specs/ai-m-1-execution-plan.md` … `specs/ai-m-7-execution-plan.md`) with detailed agent tasks, dependencies, acceptance checklists, and testing maps following `specs/archive/execution-plan.md` template. Link plans from `specs/ai-requirements.md`.


## 2026-05-25 09:52 (UTC+3)

- **Activity rail visual update:** Updated `app/src/lib/components/ActivityRail.svelte` to add a separator between Notepad and workspace items, render workspace buttons as square letter badges using a new `workspaceInitial()` helper (first letter of folder name, uppercased), and preserve existing click/contextmenu behaviors and ARIA labels.
- **Active rail emphasis:** Switched active Notepad/workspace button styling to an explicit accent-based highlight (`--color-accent`) via border/background treatment while retaining existing hover/focus behavior and add-button placement at the bottom.
- **Status bar alignment:** Updated `app/src/routes/+page.svelte` status message styling so transient labels like `Workspace added.` and `Saved <path>` align vertically with adjacent status segments.

## 2026-05-25 09:00 (UTC+3)

- **Project panel resize:** Updated `app/src/lib/components/ProjectPanel.svelte` with a left-edge drag handle (`.project-panel-resize-handle`) that resizes the right-side panel width in local component state (`panelWidth`) with clamped bounds (`180..520`) and `col-resize` cursor behavior during drag.
- **Project panel controls:** Switched collapse/expand button glyphs in `ProjectPanel.svelte` from `‹/›` to `⟫/⟪` while preserving existing collapsed-width behavior (`project-panel-collapsed` stays `36px`).
- **Tree expandability gating:** Added `canExpand` prop to `app/src/lib/components/ProjectTreeNode.svelte`; chevron now renders only for expandable directories and directory click no-ops when expansion is unavailable.
- **Tree list rendering guard:** Updated `app/src/lib/components/ProjectTreeList.svelte` to compute and pass `canExpand`, and to render nested child blocks only when `canExpand` is true (while still allowing not-yet-loaded directories to expand).

## 2026-05-24 23:02 (UTC+3)

- **Debug cleanup:** Removed temporary layout/context investigation instrumentation from `app/src/routes/+page.svelte` (`emitDebugLog`, debug keys/run id, and all `#region agent log` blocks/calls, including the debug-only reactive context logger).
- **Layout fix retained:** Kept responsive behavior and structural layout fixes, including `editorShellEl` binding usage, `.editor-shell { grid-column: 2; }`, and project panel column assignment.

## 2026-05-24 22:54 (UTC+3)

- **Hotfix: responsive project panel collapse:** Updated `app/src/routes/+page.svelte` to use transient local `autoProjectPanelCollapsed` state instead of mutating persisted `projectPanelCollapsed` in responsive logic. `showProjectPanel` now respects both persisted manual collapse and temporary auto-collapse.
- **Console auto-close behavior:** Preserved width-based console close behavior while using effective collapsed state (`manual || auto`) so console closes under 900px only when the panel is effectively collapsed.

## 2026-05-24 22:47 (UTC+3)

- **Workspaces M5 shell behavior:** Updated `app/src/routes/+page.svelte` to close console on any active context change (including non-rail/routing-driven switches) by watching `activeContextId` transitions centrally.
- **Responsive shell rules:** Added `ResizeObserver`-driven width tracking for shell middle row and editor pane; auto-collapses project panel under 1100px when workspace context is active, and auto-closes console under 900px once the panel is collapsed.
- **Markdown split fallback:** Introduced `setMarkdownViewMode` + preferred mode tracking with measured editor-width gating (`760px` threshold), forcing split requests to `edit` when space is insufficient and automatically restoring split once width recovers.

## 2026-05-24 22:40 (UTC+3)

- **Workspaces M4 project panel:** Added lazy project-tree service (`projectTree.ts`) with one-call directory loading, folders-first alphabetical sorting, hidden-file toggle behavior, symlink skipping, and openable-file filtering aligned with existing folder-open rules.
- **Tree UI components:** Implemented `ProjectPanel.svelte`, `ProjectTreeView.svelte`, `ProjectTreeList.svelte`, `ProjectTreeNode.svelte`, plus `FileIcon.svelte` / `DirectoryIcon.svelte`; includes recursive expand/collapse, loading rows, path tooltips, active-file highlighting, and scroll-into-view for selected tree nodes.
- **Shell integration + persistence:** Integrated project panel into `+page.svelte` as right column in workspace mode, wired single-click open via `openActivePath`, lazy ancestor expansion/loading for active files, refresh and show-hidden controls, and persisted panel collapsed state in window session snapshots (`projectPanelCollapsed` in `editorPreferences`).
- **Design tokens + coverage:** Added `--project-panel-width` and `--tree-indent` tokens, introduced `projectTree.test.ts` coverage, and updated existing state/session tests for new persisted editor preference.

## 2026-05-24 22:18 (UTC+3)

- **Workspaces M3 routing + policy:** Added `workspacePaths` helpers (`isPathUnderRoot`, `ensureNotepadForOutsidePath`, `runInNotepadContext`) and wired path-open routing so outside-root opens switch to Notepad, while existing-tab lookup now scans all local contexts and focuses the owner context/tab.
- **Notepad-only commands:** Applied shared Notepad gate to `file.openRecent`, `file.openAllInFolder`, and tab-menu **Open All Nearby**, ensuring those entrypoints always run and open tabs in Notepad context while keeping global recent-files behavior unchanged.
- **File/Open/Save As + multi-window behavior:** Updated file dialogs to default to active workspace root, Save As to use workspace-root defaults and move outside-root saves to Notepad, and blocked `tab.moveToNewWindow` from workspace context; `createNewWindowWithTransfer` now opens blank Notepad-only windows unless explicit Notepad transfer payload is provided.
- **Docs execution tracking:** Marked Milestone 3 tasks (`M3-1` through `M3-5`) as done in `specs/workspaces-execution-plan.md`.

## 2026-05-24 21:53 (UTC+3)

- **Workspaces M2:** Implemented the activity-rail milestone end-to-end: added `ActivityRail.svelte` (Notepad, workspace buttons, add button), integrated it into the shell layout, and wired context switching to `appState.switchContext` with console close + markdown mode reset on switch.
- **Workspace lifecycle UI:** Added `workspace.add` / `workspace.close` command wiring, File menu **Add Workspace**, folder-picker add flow with duplicate rejection notify, and workspace right-click custom flyout with **Close Workspace** and batched close behavior (Save All / Discard All / Cancel).
- **Settings and persistence:** Added `hideActivityRailWhenNotepadOnly` setting (default on), surfaced it in settings UI, persisted it via `settingsStore`, and made rail visibility reactive (hidden when notepad-only + setting on; auto-shows once workspaces exist).
- **Validation:** Updated impacted tests/types and validated with `npm run check` and `npm test` (existing `FindReplacePanel.svelte` a11y warning remains unchanged).

## 2026-05-24 21:45 (UTC+3)

- **Workspaces M1:** Implemented Milestone 1 foundation end-to-end in app code: naming cleanup (`resetAppState`, `.editor-pane`, `.markdown-layout`), new context/workspace domain contracts, context-aware `appState` core (active context selectors + workspace lifecycle reducers), and session snapshot v2 (`activeContextId`, `notepad`, `workspaces[]`, shared `editorPreferences`).
- **State and persistence:** Added `switchContext`, `addWorkspace`, `closeWorkspace` reducers with duplicate-path guard and batched close-action contract; reset transient editor chrome on context switches while keeping shared zoom/wrap stable; migrated session/open-file-registry services and tests to snapshot version 2 (no v1 migration shim).
- **Validation:** Updated affected unit tests across state/services/commands and verified `npm test` + `npm run check` pass (with one pre-existing Svelte accessibility warning in `FindReplacePanel.svelte`).

## 2026-05-26

- **Specs:** Resolved implementation decisions in `specs/workspaces-milestone-plan.md` and `specs/workspaces-execution-plan.md` — editor chrome hybrid (shared zoom/wrap), batched close-workspace dirty dialog, ResizeObserver layout + markdown split fallback, session size v1 + optional M5-5 lean snapshot task.

## 2026-05-25

- Added `specs/workspaces-execution-plan.md` — agent task breakdown for Workspaces (25 tasks across M1–M5), following `specs/archive/execution-plan.md` template.
- **Specs:** Expanded Milestone 4 in `specs/workspaces-milestone-plan.md`.

## 2026-05-24 (workspaces planning)

- Added `specs/workspaces-milestone-plan.md` — source of truth for the Workspaces feature: consolidated design decisions (contexts, file routing, Notepad-only commands, console, layout, naming) and a five-milestone roadmap.
- Archived `specs/workspaces-questions.md` → `specs/archive/workspaces-questions.md`.

## 2026-05-24

- **UI:** Added an in-app **Console** panel toggled by clicking the status bar. Shows scrollable, copyable diagnostic logs; console mounts lazily when opened.
- **UI:** Fixed status bar layout so it stays visible and clickable when the console is closed (footer was landing in a zero-height grid row).
- **Tauri:** Added window size/position restore permissions to fix `setupRuntime failed` on session restore.
- **File:** Added **File → Open Recent** with up to 15 globally shared entries, tilde-shortened labels (home plus Documents/Desktop/Downloads elided), automatic pruning of missing files, and **Clear Recent** (disabled when empty). Recent list persists at app session level and syncs across windows.
- **File:** Added **File → Open all in Folder** to recursively open up to 20 code/text files from a chosen directory (with confirmation when more match), skipping hidden/dot paths and common vendor/build folders. Extensionless plain-text note files (no `.` in the filename) are included.
- **File:** Fixed File menu corruption after bulk opens by serializing Open Recent menu refreshes and batching recent-files persistence during folder open.
- **Settings:** Removed the debug recent-files counter from the settings pane.
- **Settings:** "Decorate plaintext symbols" is enabled by default for new sessions and when the setting is missing from persisted settings.
- **Themes:** Syntax highlight colors now follow the active accent theme. Keywords, types, links/functions, and plaintext symbol decorations use accent-derived colors; strings, comments, numbers, headings, markup, and punctuation keep fixed semantic palettes per light/dark mode.
