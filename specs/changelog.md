# Changelog

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
