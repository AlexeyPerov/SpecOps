# Changelog

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
