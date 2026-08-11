# M6.1 — Pre-refactor test coverage

**Parent:** [execution-plan-m6-refactoring.md](./execution-plan-m6-refactoring.md)  
**Prerequisite:** [execution-plan-m5-custom-modes.md](./execution-plan-m5-custom-modes.md) complete (M5 shipped)  
**Next:** [M6.2 UI](./execution-plan-m6-2-ui-refactoring.md), [M6.3 State](./execution-plan-m6-3-state-refactoring.md) (parallel after M6.1)

How to use this plan: each task lists **Required context**. This sub-milestone **adds tests only** — no production refactors. Run before M6.2–M6.4 to close coverage gaps identified in the 2026-06-07 audit.

## Description

The repo has **96 test files / 779 tests** with strong coverage for `appState`, `chatStore`, `sendChatMessage`, persistence, and external file changes — all via **public store/service APIs**. There is **no Svelte component test harness** (`@testing-library/svelte` is not installed).

Gaps that increase refactor risk:

| Area | Gap |
|------|-----|
| **Settings slice CRUD** | `addHttpConnection`, `removeHttpConnection`, `addCustomChatMode`, etc. untested at slice level |
| **documentTabsSlice** | `migrateNotepadFileTabToWorkspace` has no test |
| **chatStore threads** | `switchThreadConnection`, `removeMessage`, `compactActiveThread` lack direct unit tests |
| **Command registry** | ~15 of ~25 command handlers untested |
| **UI-adjacent logic** | No tests for extractable handlers (tab context menu, close-tab flow, editor commands) |
| **Large Svelte components** | `SettingsDialog`, `+page`, `ChatComposer`, `EditorSurface`, `TabBarContextMenu` — zero component tests |

M6.1 adds **targeted unit tests** for logic that will move during M6.2–M6.4. Full component testing and post-refactor test file splits are out of scope here (M6.4 Task 6 handles file reorganization).

## Goal

1. Add unit tests for **untested public APIs** on refactor-critical paths before any file moves.
2. Add tests for **pure helpers** that M6.2 will extract from Svelte components (so extractions are test-backed).
3. Increase test count; **no reduction** in existing coverage.
4. `npm test` / `npm run check` pass after every task.

## Decisions applied

| ID | Decision | Implication |
|----|----------|-------------|
| TC-1 | A | **No `@testing-library/svelte`** in M6.1 — test extractable logic and public APIs only |
| TC-2 | A | Tests target **behavior**, not line coverage percentages |
| TC-3 | A | New test files colocated with modules they cover |
| TC-4 | A | M6.1 does **not** split large test files (deferred to M6.4 Task 6) |

## Confidence and Risks

Confidence: High.

Residual uncertainties:

1. **`migrateNotepadFileTabToWorkspace`** may need workspace/notepad fixture setup — follow patterns in `appState.test.ts` tab transfer tests.
2. **Editor command tests** may need a minimal CodeMirror `EditorState` fixture — keep tests focused on pure ops where possible.

## Agent Level Legend

- `easy`: straightforward test additions.
- `medium`: moderate fixture/setup.
- `heavy`: multi-context state setup.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.

## Task Breakdown

#### Task 1: settingsSlice CRUD tests (P2-10) [Score:6] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/state/appState/settingsSlice.ts`
2. `app/src/lib/state/appState.test.ts` — existing settings/theme tests pattern
3. `app/src/lib/ai/modes/chatModesSettings.ts`, `app/src/lib/ai/providers/httpConnectionSettings.ts`

- Add `app/src/lib/state/appState/settingsSlice.test.ts` (or extend `appState.test.ts` with a dedicated `describe` block).
- Cover via public `appState` API:
  - `addHttpConnection` / `updateHttpConnection` / `removeHttpConnection` / `setDefaultConnectionId`
  - `addCustomChatMode` / `updateCustomChatMode` / `removeCustomChatMode`
  - `setRawEnabled` / `updateBuiltinModeToggles`
  - `setDebugChatProviderSettings` / `setDebugWorkspaceProviderSettings` (patch variants)
  - `updateProviderModelCatalog` / `setProviderApiKey`
- Assert normalized settings shape after each mutator (invalid input rejected or normalized per existing rules).

**Acceptance checklist**

- Every settings-slice CRUD method used by `SettingsDialog` has at least one test.
- Removing default connection falls back per `httpConnectionSettings` rules.
- Custom mode remove does not break `defaultSettings` presets shape on fresh reset.
- `npm test` passes.

Dependencies: none.

---

#### Task 2: documentTabs and notepad migration tests (P2-10) [Score:6] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/state/appState/documentTabsSlice.ts` — `migrateNotepadFileTabToWorkspace`
2. `app/src/lib/state/appState.test.ts` — tab transfer tests (`buildTabTransferPayload`, `openTransferredTab`)
3. `app/src/lib/services/openFileGate.ts` — caller

- Add tests for `migrateNotepadFileTabToWorkspace`:
  - Notepad file tab moves to workspace context with same document
  - Duplicate path in workspace focuses existing tab instead of duplicating
  - Notepad tab removed after successful migration
- Add any missing tests for `renameDocument` on `appState` if not already covered.

**Acceptance checklist**

- `migrateNotepadFileTabToWorkspace` has ≥2 scenarios covered.
- Existing tab transfer tests still pass.
- `npm test` passes.

Dependencies: none.

---

#### Task 3: chatStore thread internals tests (P2-10) [Score:6] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/state/chatStore/threads.ts`
2. `app/src/lib/state/chatStore.test.ts`
3. `app/src/lib/ai/sendChatMessage.test.ts` — indirect coverage of `updateMessageContent` / `removeMessage`

- Add `app/src/lib/state/chatStore/threadMessages.test.ts` or extend `chatStore.test.ts`:
  - `updateMessageContent` — updates assistant message in place
  - `removeMessage` — removes by id; returns false when missing
  - `compactActiveThread` — compacts when over retention threshold
- Add `app/src/lib/state/chatStore/threadProviderSelection.test.ts` or extend `chatStore.test.ts`:
  - `switchThreadConnection` — updates `connectionId`, logs system event, rejects invalid connection
  - Provider switch blocked while generating (if applicable)

**Acceptance checklist**

- Direct tests exist for all four methods above.
- Provider/connection switch tests do not duplicate M4/M5 validation suites unnecessarily.
- `npm test` passes.

Dependencies: none.

---

#### Task 4: Command registry handler coverage (P2-10) [Score:7] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/commands/registry.ts` — full `handlers` map
2. `app/src/lib/commands/registry.test.ts` — existing handler tests
3. `app/src/lib/commands/openAndStoreFile.test.ts`

- Extend `registry.test.ts` (or add `commands/handlers.integration.test.ts`) for **untested** handlers:
  - `file.open`, `file.openRecent`, `file.saveAs`, `file.rename`, `file.reloadFromDisk`, `file.clearRecentFiles`, `file.openAllInFolder`
  - `app.toggleSettings`, `app.toggleFindReplace`, `app.toggleGoTo`
  - `edit.undo`, `edit.redo`, `edit.indent`, `edit.outdent`, `edit.moveLineUp`, `edit.moveLineDown`, `edit.duplicateLine`, `edit.joinLines`
  - `view.toggleWrap`, `view.zoomIn`, `view.zoomOut`, `view.zoomReset`
- Mock Tauri/fs/editor dependencies consistent with existing `registry.test.ts` patterns.
- At minimum: each handler group has one happy-path and one guard-path test.

**Acceptance checklist**

- Every `AppCommandId` in `commandDefinitions` has at least one dispatch test.
- No regression in existing registry tests.
- `npm test` passes.

Dependencies: none.

---

#### Task 5: closeTabFlow and tab context menu action tests (P2-10) [Score:5] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/services/closeTabFlow.ts`
2. `app/src/lib/components/TabBarContextMenu.svelte` — action handlers to extract in M6.2 Task 8
3. `app/src/lib/services/unsavedClosePrompt.test.ts` if present

- Add `app/src/lib/services/closeTabFlow.test.ts`:
  - `closeTabWithUnsavedPrompt` — saves/discards/cancels paths
  - `closeOtherTabsWithUnsavedPrompt` / `closeTabsToRightWithUnsavedPrompt` — abort on cancel
- If `tabContextMenuActions.ts` does not exist yet, add tests against **inline logic** in `TabBarContextMenu.svelte` via a thin exported helper module created for testability (minimal production change: export pure functions only).

**Acceptance checklist**

- Close-tab-with-dirty-prompt flows covered (not only mocked in `registry.test.ts`).
- Tab context menu close/reveal/nearby actions have ≥1 test each for extractable logic.
- `npm test` passes.

Dependencies: none.

---

#### Task 6: Editor command and search ops tests (P2-10) [Score:5] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/components/EditorSurface.svelte` — `moveLine`, `duplicateLine`, `joinLines`, find/replace
2. `app/src/lib/types/editor.ts`
3. M6.2 Task 7 — planned extraction to `editorCommandRunner.ts`, `editorSearchOps.ts`

- Extract **testable pure functions** (or create them preemptively in `editor/editorSearchOps.ts` and `editor/editorLineOps.ts`) for:
  - Line move up/down text transforms
  - Duplicate line / join lines text transforms
  - Find next/previous index logic (case sensitive/insensitive)
  - Replace current / replace all counting
- Add `editor/editorSearchOps.test.ts` and `editor/editorLineOps.test.ts`.
- Keep CodeMirror `EditorView` integration out of scope — unit-test string/selection operations only.

**Acceptance checklist**

- ≥8 unit tests across line ops and search ops.
- Tests run without browser/DOM (pure functions).
- `npm test` passes.

Dependencies: none (optional thin extraction of pure helpers is allowed).

---

#### Task 7: App shell and settings helper tests (P2-10) [Score:5] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/components/SettingsDialog.svelte` — update helpers to extract in M6.2 Task 1
2. `+page.svelte` — workspace context menu and project tree handlers (M6.2 Tasks 4–5)
3. `app/src/lib/services/appShellHelpers.test.ts`

- Add `app/src/lib/components/settings/settingsPanelActions.test.ts` (create module with pure helpers if needed):
  - External files KB normalization (`updateMaxBinaryOpenAsTextKb`, `updateMaxOpenWithoutConfirmKb` logic)
  - Connection list selection helpers
  - Custom mode ordered-section list mutations (add/remove/reorder)
- Add `app/src/lib/services/workspaceContextMenuController.test.ts`:
  - `resolveCloseWorkspaceAction` dirty-document branches
  - Workspace reorder index bounds
- Extend `appShellHelpers.test.ts` or add `appShellLayoutHandlers.test.ts` for any pure layout decision functions extracted or identified for extraction.

**Acceptance checklist**

- Settings panel action helpers used by ≥2 tabs have tests.
- Workspace close/reorder logic has ≥3 tests.
- `npm test` passes.

Dependencies: Tasks 1–6 (can run in parallel if helpers are identified independently).

---

#### Task 8: M6.1 validation (P2-10) [Score:3] [Agent:easy] [DONE]

**Required context**

1. All M6.1 tasks
2. [execution-plan-m6-refactoring.md](./execution-plan-m6-refactoring.md)

- Run `npm test` and `npm run check` from `app/`.
- Record baseline test count (expect increase from 779).
- Mark M6.1 tasks `[DONE]` and exit criteria below.
- Changelog entry for M6.1 completion.

**Acceptance checklist**

- All M6.1 tasks marked `[DONE]`.
- Test count ≥ 779 and strictly greater than pre-M6.1 unless audit shows all gaps were already covered.
- `npm test` / `npm run check` pass.

Dependencies: Tasks 1–7.

---

## Dependency graph

```text
Task 1, 2, 3, 4, 5, 6 — parallel
Task 7 — after 1–6 (or parallel if scoped to independent helpers)
Task 8 — after 1–7
```

## M6.1 exit criteria

- [x] `settingsSlice` CRUD covered by unit tests.
- [x] `migrateNotepadFileTabToWorkspace` covered.
- [x] `switchThreadConnection`, `removeMessage`, `compactActiveThread`, `updateMessageContent` have direct tests.
- [x] Every `AppCommandId` has at least one dispatch test.
- [x] `closeTabFlow` covered beyond registry mocks.
- [x] Editor line/search pure ops have unit tests.
- [x] Settings panel and workspace context menu extractable helpers have unit tests.
- [x] `npm test` / `npm run check` pass.

## Non-goals (M6.1)

- Svelte component rendering tests.
- Splitting large test files (M6.4 Task 6).
- Production refactors (M6.2–M6.4).
- E2E or Tauri integration tests.

## Key files (expected touch)

| Area | Files |
|------|--------|
| Settings state | `settingsSlice.test.ts`, `settingsPanelActions.ts`, `settingsPanelActions.test.ts` |
| Tabs | `appState.test.ts` or `documentTabsSlice.test.ts` |
| Chat store | `threadMessages.test.ts`, `threadProviderSelection.test.ts` |
| Commands | `registry.test.ts`, optional `handlers.integration.test.ts` |
| Tab menu / close | `closeTabFlow.test.ts`, `tabContextMenuActions.ts` |
| Editor | `editorLineOps.ts`, `editorSearchOps.ts`, `*.test.ts` |
| App shell | `workspaceContextMenuController.test.ts`, `appShellLayoutHandlers.test.ts` |

## Changelog

| Date | Change |
|------|--------|
| 2026-06-07 | M6.1 complete — Tasks 7–8: `settingsPanelActions`, `workspaceContextMenuController` helpers + tests; validation 908 tests, check pass |
| 2026-06-07 | Initial M6.1 sub-plan — pre-refactor test coverage gaps |
