# M6.3 — State slices and domain types refactoring

**Parent:** [execution-plan-m6-refactoring.md](./execution-plan-m6-refactoring.md)  
**Prerequisite:** [M6.1 test coverage](./execution-plan-m6-1-test-coverage.md) complete  
**Parallel with:** [M6.2 UI](./execution-plan-m6-2-ui-refactoring.md) (after M6.1)

How to use this plan: each task lists **Required context**. Preserve the public `appState` and `chatStore` APIs unless the task explicitly allows narrowing.

## Goal

Split oversized state slices and the domain type monolith into focused modules without behavior changes.

## Task Breakdown

#### Task 1: Split domain contracts into modules (P2-10) [Score:7] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/domain/contracts.ts` — all exported types and helpers
2. Grep imports of `../domain/contracts` across `app/src`

- Create `app/src/lib/domain/` modules:
  - `document.ts` — `DocumentState`, `DocumentContentKind`, `MarkdownViewMode`, `DiskFingerprint`, tab types (`FileTabState`, `AgentTabState`, `TabState`, helpers)
  - `workspace.ts` — `ContextId`, `ContextSnapshot`, `WorkspaceContext`, `SessionState`, `WorkspaceLayoutState`, `WindowContextState`
  - `settings.ts` — `AppSettingsState`, `ExternalFilesSettings`, provider settings, `ChatModesSettings`, `LogSettings`, HTTP connections
  - `chat.ts` — chat messages, threads, agents index, modes, providers, system events
  - `commands.ts` — `AppCommandId`, `CommandDefinition`, bindings, payloads
  - `persistence.ts` — `AppDomainState`, session snapshots, open file registry
- Replace `contracts.ts` with a **barrel re-export** of all public symbols (no import churn in follow-on tasks).
- Move type-only tests if any exist; add `domain/contracts.barrel.test.ts` smoke import test.

**Acceptance checklist**

- `contracts.ts` ≤80 lines (re-exports only).
- Each domain module ≤200 lines (except `settings.ts` / `chat.ts` ≤300).
- `npm test` / `npm run check` pass with zero import updates required at call sites.

Dependencies: M6.1 complete.

---

#### Task 2: Split documentTabsSlice (P2-10) [Score:9] [Agent:heavy] [DONE]

**Required context**

1. `app/src/lib/state/appState/documentTabsSlice.ts`
2. [M6.1 Task 2](./execution-plan-m6-1-test-coverage.md) — migration tests
3. `app/src/lib/state/appState/tabHelpers.ts`, `documentHelpers.ts`, `contextHelpers.ts`
4. `app/src/lib/state/appState.ts` — slice composition

- Split into:
  - `documentTabsSlice.ts` — tab lifecycle only: `createTab`, `selectTab`, `closeTab*`, `reorderTabs`, `openOrFocusAgentTab`, `closeTabsForAgent`, `selectOrReopenTabForDocument`, `findDocumentIdByPath`, `closeMissingFileTabs`
  - `documentContentSlice.ts` — document mutations: `setDocumentContent`, `markDocumentSaved`, `applyDocumentDiskReload`, `applyDocumentKeepLocal`, `setDocumentDiskState`, `renameDocument`, `setDocumentScrollTop`, `setDocumentMarkdownViewMode`, `refreshUntitledTitle`, `normalizeUntitledTitles`, `upgradeDocumentFromOpenedFile`, `openFileInTab`
  - `tabTransferSlice.ts` — cross-window: `buildTabTransferPayload`, `removeTransferredTab`, `transferActiveTabOut`, `openTransferredTab`, `migrateNotepadFileTabToWorkspace`
- `createDocumentTabsSlice` in `appState.ts` composes all three; **or** export three `create*Slice` factories merged in `appState.ts`.
- Keep `appState` method names identical (re-export / delegate).

**Acceptance checklist**

- No single slice file >450 lines.
- M6.1 migration and tab transfer tests pass.
- Tab close, open file, save, transfer, and notepad migration behaviors unchanged.

Dependencies: Task 1; M6.1 Task 2.

---

#### Task 3: Split settingsSlice by domain (P2-10) [Score:7] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/state/appState/settingsSlice.ts`
2. [M6.1 Task 1](./execution-plan-m6-1-test-coverage.md) — settingsSlice CRUD tests
3. `app/src/lib/ai/modes/chatModesSettings.ts`
4. `app/src/lib/ai/providers/httpConnectionSettings.ts`, `debugProviderSettings.ts`

- Split into:
  - `settingsSlice.ts` — thin composer + `defaultSettings` + general settings (`statusBarVisible`, `externalFiles`, `decoratePlaintextSymbols`, `hideActivityRailWhenNotepadOnly`, `commandBindingOverrides`)
  - `providerSettingsSlice.ts` — debug chat/workspace provider, HTTP connections CRUD, default connection, API keys, model catalogs
  - `chatModesSettingsSlice.ts` — `rawEnabled`, builtin toggles, custom mode CRUD (delegate normalization to `ai/modes/chatModesSettings.ts`)
  - `logSettingsSlice.ts` — `logSettings` mutators
- `createSettingsSlice` merges slices; `appState` public API unchanged.

**Acceptance checklist**

- No settings slice file >350 lines.
- M6.1 settings CRUD tests pass unchanged (update import paths only if needed).
- Settings dialog and persistence still read/write same `AppSettingsState` shape.

Dependencies: Task 1; M6.1 Task 1.

---

#### Task 4: Split chatStore threads slice (P2-10) [Score:8] [Agent:heavy] [DONE]

**Required context**

1. `app/src/lib/state/chatStore/threads.ts`
2. [M6.1 Task 3](./execution-plan-m6-1-test-coverage.md) — thread internals tests
3. `app/src/lib/state/chatStore/threadHelpers.ts`, `agents.ts`, `access.ts`
4. `app/src/lib/state/chatStore.ts` — slice wiring

- Split into:
  - `threadMessages.ts` — `appendMessage`, `updateMessageContent`, `removeMessage`, `compactActiveThread`, `getMessages`
  - `threadMetadata.ts` — `setAgentThread`, `setWorkspaceThread`, `updateThreadMetadata`, `getMetadata`, `getActiveThreadSnapshot`, `hasThread`, `isEmpty`
  - `threadProviderSelection.ts` — `getActiveChatProvider`, `getActiveChatModel`, provider/connection/model switch methods and logging
- `createThreadsSlice` in `threads.ts` composes the three (or rename to `createThreadsSlice.ts` index).
- `chatStore` public API unchanged.

**Acceptance checklist**

- No threads module file >400 lines.
- M6.1 thread message/provider tests pass.
- Send, mode/provider switch, compaction, and thread load behaviors unchanged.

Dependencies: Task 1; M6.1 Task 3.

---

## Dependency graph

```text
M6.1 complete → Task 1 → Task 2 (M6.1 Task 2)
                    ↘ Task 3 (M6.1 Task 1)
                    ↘ Task 4 (M6.1 Task 3)
```

Tasks 2, 3, 4 can run in parallel after Task 1.

## M6.3 exit criteria

- [x] All tasks marked `[DONE]`.
- [x] `contracts.ts` is a barrel; domain modules under `domain/`.
- [x] `documentTabsSlice` split complete; largest slice file ≤450 lines.
- [x] `settingsSlice` split complete; largest settings slice file ≤350 lines.
- [x] `chatStore/threads` split complete.
- [x] `npm test` / `npm run check` pass.

## Changelog

| Date | Change |
|------|--------|
| 2026-06-07 | Renamed from M6-State; prerequisite M6.1 added |
| 2026-06-07 | Initial M6-State sub-plan — contracts, documentTabs, settings, threads |
