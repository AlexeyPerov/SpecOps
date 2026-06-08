# M6.4 — Commands, services, and post-refactor test organization

**Parent:** [execution-plan-m6-refactoring.md](./execution-plan-m6-refactoring.md)  
**Prerequisite:** [M6.2 UI](./execution-plan-m6-2-ui-refactoring.md) and [M6.3 State](./execution-plan-m6-3-state-refactoring.md) substantially complete  
**Follows:** [M6.1 test coverage](./execution-plan-m6-1-test-coverage.md) (pre-refactor tests already added)

How to use this plan: each task lists **Required context**. Behavior-preserving only.

## Goal

Split command registry, services, and send pipeline. Reorganize large test files to mirror production modules. Final validation confirms the full M6 milestone.

## Task Breakdown

#### Task 1: Split commands registry (P2-10) [Score:8] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/commands/registry.ts`
2. [M6.1 Task 4](./execution-plan-m6-1-test-coverage.md) — handler dispatch tests
3. `app/src/lib/commands/commandBindings.ts`, `openAndStoreFile.ts`
4. `app/src/lib/domain/contracts.ts` — `AppCommandId`

- Extract `commandDefinitions` to `app/src/lib/commands/definitions.ts`.
- Extract handlers to `app/src/lib/commands/handlers/`:
  - `app.ts` — theme pane, settings, new window, find/go-to toggles
  - `file.ts` — new, open, save, rename, reload, recent, open all in folder
  - `workspace.ts` — add, close, reorder workspace
  - `edit.ts` — undo, redo, indent, line ops
  - `view.ts` — markdown/diff preview, wrap, zoom
- `registry.ts` retains: `handlers` merge, `dispatchCommand`, `dispatchMenuCommand`, `keymapCommandForEvent`, `getRegisteredCommandIds`, `getActiveDocumentContent`, binding override wiring.
- Re-export `commandDefinitions` from `registry.ts` for backward compatibility.

**Acceptance checklist**

- `registry.ts` ≤250 lines.
- Each handler module ≤250 lines.
- M6.1 registry dispatch tests pass (update paths only).
- All menu shortcuts and command dispatch behaviors unchanged.

Dependencies: M6.3 Task 1 (if `AppCommandId` moved); M6.1 Task 4.

---

#### Task 2: Split chatPersistence (P2-10) [Score:6] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/services/chatPersistence.ts`
2. `app/src/lib/services/chatRetention.ts`
3. Consumers: `chatStore`, `sendChatMessage`, `ChatComposer`

- Split into:
  - `chatPersistenceCodec.ts` — `encode*` / `decode*`, `upsertAgentIndexEntry`, `removeAgentIndexEntry`, `countConversationTurns`, `needsChatCompaction`, path hash helpers
  - `chatPersistencePaths.ts` — `getWorkspaceAgentsDir`, index/thread file path resolvers, `chatScopeStorageSegment`
  - `chatPersistence.ts` — async read/write, `schedule*` debounce, `persistAgentThreadSnapshot`, `deleteAgent*`, re-exports
- `resetChatPersistenceForTests` stays in main module or `chatPersistenceTestUtils.ts`.

**Acceptance checklist**

- No file >350 lines.
- `chatPersistence.test.ts` passes.
- Thread and agent index persistence unchanged.

Dependencies: none.

---

#### Task 3: Split sendChatMessage pipeline (P2-10) [Score:5] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/ai/sendChatMessage.ts`
2. `app/src/lib/ai/chatSend.ts`, `chatErrorCopy.ts`
3. `app/src/lib/ai/providers/*`

- Split into:
  - `sendChatMessage.ts` — public `sendChatMessage` orchestration only
  - `retryChatTurn.ts` — `retryLastChatTurn` and retry-specific guards
  - `sendChatMessageInternals.ts` (or `chatSendPipeline.ts`) — shared preflight, provider dispatch, streaming callbacks, compaction triggers (private to folder)
- Keep public exports stable from `sendChatMessage.ts` (re-export retry if imported elsewhere).

**Acceptance checklist**

- `sendChatMessage.ts` ≤200 lines.
- No send/retry behavior change.
- `sendChatMessage.test.ts` passes (reorganized in Task 6).

Dependencies: M6.3 Task 4 optional.

---

#### Task 4: Split appMenu and externalFileChanges (P2-10) [Score:5] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/services/appMenu.ts`
2. `app/src/lib/services/externalFileChanges.ts`
3. `app/src/lib/commands/registry.ts` — menu command dispatch

**appMenu.ts**

- Extract menu structure builders: `appMenuDefinitions.ts` (static menu tree from `commandDefinitions`).
- Keep Tauri menu install/refresh/update in `appMenu.ts`.

**externalFileChanges.ts**

- Extract reload policy helpers: `externalFileReloadPolicy.ts` (deferred check, auto-reload clean files, focus/tab activate gates).
- Keep file watcher registration and `checkDocumentIfDeferred` orchestration in main module.

**Acceptance checklist**

- `appMenu.ts` ≤300 lines.
- `externalFileChanges.ts` ≤300 lines.
- Application menu and external file reload behaviors unchanged.
- `appMenu.test.ts` and `externalFileChanges.test.ts` pass.

Dependencies: Task 1 (command definitions location).

---

#### Task 5: Split sessionManager and themeTokens (P2-10) [Score:4] [Agent:easy] [DONE]

**Required context**

1. `app/src/lib/services/sessionManager.ts`
2. `app/src/lib/styles/themeTokens.ts`
3. `app/src/lib/state/appState/themeController.ts`

**sessionManager.ts**

- Extract snapshot encode/decode/normalize to `sessionSnapshotCodec.ts`.
- Keep debounced persist schedule and restore orchestration in `sessionManager.ts`.

**themeTokens.ts**

- Extract builtin token tables to `themeTokenDefaults.ts` (dark-amber, light-blue palettes, syntax palettes).
- Keep `apply*` / `resolve*` / `snapshotThemeTokens` in `themeTokens.ts`.

**Acceptance checklist**

- `sessionManager.ts` ≤250 lines.
- `themeTokens.ts` ≤200 lines.
- Session restore and theme apply unchanged.
- `sessionManager.test.ts`, `themes.test.ts` pass.

Dependencies: none.

---

#### Task 6: Reorganize large test files (P2-10) [Score:6] [Agent:medium] [DONE]

**Required context**

1. M6.2, M6.3, M6.4 Tasks 1–5 outcomes
2. [M6.1](./execution-plan-m6-1-test-coverage.md) — pre-refactor tests already added
3. `app/src/lib/state/chatStore.test.ts` (~1,090 lines)
4. `app/src/lib/state/appState.test.ts` (~1,062 lines)
5. `app/src/lib/ai/sendChatMessage.test.ts` (~983 lines)
6. `app/src/lib/commands/registry.test.ts` (~575 lines)

- Split tests to mirror production modules (preserve all M6.1-added tests):
  - `chatStore/` → `threadMessages.test.ts`, `threadMetadata.test.ts`, `threadProviderSelection.test.ts`, `agents.test.ts` (or keep `chatStore.test.ts` as aggregator with imports)
  - `appState/` → `documentTabsSlice.test.ts`, `documentContentSlice.test.ts`, `settingsSlice.test.ts`, `workspaceContextsSlice.test.ts`
  - `sendChatMessage.test.ts` → `sendChatMessage.test.ts` + `retryChatTurn.test.ts`
  - `registry.test.ts` → per-handler group tests under `commands/handlers/*.test.ts`
- No reduction in assertion coverage; move shared fixtures to `*TestHelpers.ts` files.

**Acceptance checklist**

- No test file >600 lines.
- Test count ≥ post-M6.1 baseline.
- `npm test` passes.
- `npm run check` passes.

Dependencies: Tasks 1–5; M6.1 complete.

---

#### Task 7: M6 validation, docs, and milestone close (P2-10) [Score:5] [Agent:easy] [DONE]

**Required context**

1. All M6 sub-milestone tasks (M6.1–M6.4)
2. [execution-plan-m6-refactoring.md](./execution-plan-m6-refactoring.md) — exit criteria
3. [phase-2.md](./phase-2.md)
4. `docs/architecture.md` if module layout documented there

- Run `npm test` and `npm run check` from `app/`.
- Verify line-count targets with `wc -l` on all files listed in parent findings table.
- Mark all M6 tasks `[DONE]` in sub-plans and parent exit criteria in `execution-plan-m6-refactoring.md`.
- Update [phase-2.md](./phase-2.md) milestone table with M6 summary.
- Add architecture note: preferred file size limits and split conventions (settings panels, slices, command handlers).
- Changelog entry for M6 completion.

**Acceptance checklist**

- Parent M6 exit criteria all checked.
- No production file from audit table exceeds 600 lines.
- `npm test` / `npm run check` pass.
- Phase-2 doc links all M6 execution plans.

Dependencies: M6.1, M6.2, M6.3, M6.4 Tasks 1–6.

---

## Dependency graph

```text
Task 1 → Task 4 → Task 6 → Task 7
Task 2 → Task 6 ↗
Task 3 → Task 6 ↗
Task 5 → Task 6 ↗
```

## M6.4 exit criteria

- [x] All tasks marked `[DONE]`.
- [x] Commands, persistence, send, appMenu, externalFileChanges, sessionManager, themeTokens splits complete.
- [x] Large test files reorganized; none >600 lines.
- [x] M6 validation task complete.

## Changelog

| Date | Change |
|------|--------|
| 2026-06-08 | M6.4 complete — Tasks 5–7: test reorganization, validation, docs; 888 tests pass |
| 2026-06-07 | Renamed from M6-Platform; M6.1 prerequisite clarified; Task 6 scoped to post-refactor reorganization |
| 2026-06-07 | Initial M6-Platform sub-plan — commands, services, tests, validation |
