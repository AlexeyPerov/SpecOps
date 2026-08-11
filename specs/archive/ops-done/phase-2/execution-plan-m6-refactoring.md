# Phase 2 Milestone 6 Execution Plan — Codebase refactoring

**Spec:** [phase-2.md](./phase-2.md)  
**Parent:** [roadmap.md](../roadmap.md)  
**Prerequisite:** [execution-plan-m5-custom-modes.md](./execution-plan-m5-custom-modes.md) complete (M5 shipped)  
**Related:** Technical-debt milestone; no new user-facing features. Prepares the codebase for phase 3+ growth.

How to use this plan: M6 is split into **four numbered sub-milestones**. Each sub-plan follows the same task format as M5. Read this file for scope and ordering; execute sub-milestones in order unless noted.

## Sub-milestones

| # | Sub-milestone | Focus | File |
|---|---------------|--------|------|
| **M6.1** | Test coverage | Pre-refactor unit tests for coverage gaps | [execution-plan-m6-1-test-coverage.md](./execution-plan-m6-1-test-coverage.md) |
| **M6.2** | UI | Svelte components and app shell | [execution-plan-m6-2-ui-refactoring.md](./execution-plan-m6-2-ui-refactoring.md) |
| **M6.3** | State | `appState` / `chatStore` slices and domain types | [execution-plan-m6-3-state-refactoring.md](./execution-plan-m6-3-state-refactoring.md) |
| **M6.4** | Platform | Commands, services, test file reorganization, validation | [execution-plan-m6-4-platform-refactoring.md](./execution-plan-m6-4-platform-refactoring.md) |

Recommended execution order: **M6.1 → M6.2 ∥ M6.3 → M6.4**. M6.2 and M6.3 can run in parallel after M6.1. **M6.4 Task 7** (validation) is last.

## Description

After M1–M5, several production files exceed **500 lines** and a few exceed **1,000 lines**. They mix unrelated responsibilities (UI panels, tab lifecycle, document mutations, command handlers, codecs, and side-effect orchestration). The repo already uses good patterns — slice composition (`appState/*Slice.ts`), store folders (`chatStore/*`), and partial UI extraction (`KeyboardShortcutsSettings.svelte`) — but the largest monoliths have not yet been split.

A **2026-06-07 audit** found strong logic-layer tests (779 tests) but gaps on settings-slice CRUD, notepad migration, thread internals, command handlers, and zero Svelte component tests. **M6.1** closes those gaps before refactors begin.

**Milestone 6 (refactoring)** reduces file size and coupling **without behavior changes**:

- Add targeted unit tests for untested refactor-critical paths (M6.1).
- Extract settings tab panels and app-shell orchestration from mega-components (M6.2).
- Split oversized state slices along domain boundaries (M6.3).
- Split command definitions from handlers; persistence codecs from I/O; reorganize test files (M6.4).
- Cover **all** identified targets, including lower-urgency files (400–500 lines).

Refactors are **behavior-preserving**: no data migrations, no compatibility shims, no user-visible feature changes.

## Goal

1. Pre-refactor test gaps closed (M6.1 exit criteria).
2. No production source file above **~600 lines** except generated/vendor code (target **≤500** for new extractions).
3. Each module has a **single clear responsibility** aligned with existing folder conventions.
4. `npm test` and `npm run check` pass after every sub-milestone task.
5. Large test files reorganized to mirror production module boundaries (M6.4).

## Findings summary (2026-06-07 audit)

### Test coverage assessment (pre-M6.1)

| Layer | Status |
|-------|--------|
| `appState` / `chatStore` public APIs | Strong (~57 + 44 tests) |
| `sendChatMessage`, `chatPersistence`, `externalFileChanges`, `sessionManager` | Strong |
| `commands/registry` | Partial (~10 of ~25 handlers) |
| Settings slice CRUD, `migrateNotepad`, `switchThreadConnection` | Missing direct tests |
| Svelte components (`SettingsDialog`, `+page`, etc.) | None |

### Tier 1 — split soon

| File | Lines | Issue |
|------|------:|-------|
| `SettingsDialog.svelte` | 1,699 | All settings tabs + dialog chrome + update helpers in one file |
| `+page.svelte` | 1,416 | App shell god-component: ~50 handlers, 14 `$effect` blocks |
| `documentTabsSlice.ts` | 990 | Tab lifecycle, document mutations, window transfer, notepad migration |

### Tier 2 — split when touching (included in M6)

| File | Lines | Issue |
|------|------:|-------|
| `commands/registry.ts` | 894 | Definitions array + handlers record in one file |
| `chatStore/threads.ts` | 851 | Messages, metadata, provider/model switching |
| `settingsSlice.ts` | 628 | All settings domains in one slice |
| `ChatComposer.svelte` | 671 | Send logic + mode/provider/model pickers |
| `EditorSurface.svelte` | 632 | CodeMirror setup + editor commands + find/replace |
| `TabBarContextMenu.svelte` | 606 | Menu UI + all tab context actions |
| `chatPersistence.ts` | 566 | Codec + paths + filesystem I/O + scheduling |
| `sendChatMessage.ts` | 565 | Send orchestration + retry in one module |

### Tier 3 — lower urgency (included in M6)

| File | Lines | Issue |
|------|------:|-------|
| `AgentsSidebar.svelte` | 531 | Agent list UI; will grow with future chat features |
| `domain/contracts.ts` | 476 | Type monolith for all domains |
| `services/appMenu.ts` | 455 | Menu construction grows with every command |
| `services/externalFileChanges.ts` | 449 | Watcher + reload logic combined |
| `styles/themeTokens.ts` | 438 | Token data + apply helpers |
| `services/sessionManager.ts` | 413 | Session restore/persist |

### Large tests (reorganize in M6.4)

| File | Lines |
|------|------:|
| `chatStore.test.ts` | 1,090 |
| `appState.test.ts` | 1,062 |
| `sendChatMessage.test.ts` | 983 |
| `commands/registry.test.ts` | 575 |

### Patterns to reuse

- Slice composition in `appState.ts` (`documentTabsSlice`, `settingsSlice`, `workspaceContextsSlice`).
- Store folder `chatStore/` (`threads.ts`, `agents.ts`, `runtime.ts`, `threadHelpers.ts`).
- Service extraction (`projectTreeController`, `appShellRuntime`, `closeTabFlow`).
- Partial settings UI (`KeyboardShortcutsSettings.svelte`, `settingsDialogUi.ts`).

## Decisions applied

| ID | Decision | Implication |
|----|----------|-------------|
| RF-1 | A | **Behavior-preserving** refactors only; no feature additions |
| RF-2 | A | **No data migrations** or persisted-format compatibility shims |
| RF-3 | A | Split along **existing domain boundaries** (settings tabs, command groups, slice concerns) |
| RF-4 | A | New files live next to current modules (`settings/`, `commands/handlers/`, `domain/`, etc.) |
| RF-5 | A | **Re-export** from original entry points where needed to minimize import churn in a single task |
| RF-6 | A | Target **≤500 lines** per file; **≤600** acceptable for cohesive UI shells |
| RF-7 | A | **M6.1** adds tests; **M6.4** reorganizes test files — no coverage reduction |
| RF-8 | A | **M6.1 before M6.2–M6.4** — no production refactors until pre-refactor tests land |

## Assumptions

- M5 is complete; no in-flight feature work blocks a refactor task.
- Implementation is agent-only; human role is approval/review.
- Each task is independently mergeable when its acceptance checklist passes.
- Import path churn is acceptable within a task; cross-task re-export stability preferred.

## Confidence and Risks

Confidence: High for M6.3/M6.4 mechanical extractions; Medium for M6.2 `+page.svelte` effect ordering.

Resolved constraints:

1. Natural seams already exist (SettingsDialog snippets, `commandDefinitions` vs `handlers`, slice helpers).
2. M6.1 closes the highest-risk test gaps before file moves.

Residual uncertainties:

1. **`+page.svelte` `$effect` ordering:** Extracting effects to modules must preserve Svelte 5 reactivity dependencies — prefer small composable functions called from retained `$effect` blocks in the route until a dedicated `appShellEffects.ts` pattern is proven.
2. **`appState` public API surface:** Splitting slices must keep `appState` store methods stable or update all call sites in the same task.
3. **`contracts.ts` import churn:** Split into `domain/*.ts` with barrel `contracts.ts` re-exports to avoid mass refactors in one commit.

## Agent Level Legend

- `easy`: straightforward extraction, clear boundaries.
- `medium`: moderate coupling, some call-site updates.
- `heavy`: large file, many dependents, or subtle reactivity ordering.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in the relevant sub-plan file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Dependency graph (sub-milestones)

```text
M6.1 (test coverage)
    ├──► M6.2 (UI Tasks 1–8)
    └──► M6.3 (State Tasks 1–4)     ← parallel after M6.1
              └──► M6.4 (Platform Tasks 1–7)
```

## Mapping to phase-2 task IDs

| ID | Execution plan |
|----|----------------|
| P2-10 (new) | Milestone 6 — codebase refactoring (M6.1–M6.4) |

## Milestone 6 exit criteria

- [x] M6.1 pre-refactor test coverage complete (see [M6.1 exit criteria](./execution-plan-m6-1-test-coverage.md)).
- [x] `SettingsDialog.svelte` ≤600 lines; each settings tab in its own component under `components/settings/`.
- [x] `+page.svelte` ≤600 lines; shell layout and side effects extracted.
- [x] `documentTabsSlice.ts` split into tab / document-content / transfer modules.
- [x] `commands/registry.ts` split: definitions, domain handlers, thin registry.
- [x] `chatStore/threads.ts` split into messages / metadata / provider-selection modules.
- [x] `settingsSlice.ts` split by settings domain.
- [x] Tier 2 component and service splits complete (ChatComposer, EditorSurface, TabBarContextMenu, chatPersistence, sendChatMessage).
- [x] Tier 3 splits complete (AgentsSidebar, appMenu, externalFileChanges, themeTokens, sessionManager).
- [x] `contracts.ts` becomes barrel over `domain/*` modules.
- [x] Large test files reorganized; none >600 lines.
- [x] `npm test` / `npm run check` pass.

## Non-goals (M6)

- New features, UX changes, or settings tabs.
- Svelte component rendering tests (M6.1 uses logic/API tests only).
- Performance optimization beyond incidental import-tree improvements.
- Rewriting state management (no move to different store library).
- Deleting tests or reducing coverage.
- Refactoring `node_modules`, generated, or config-only files.

## Key files (expected touch)

| Area | Files |
|------|--------|
| Tests (M6.1) | `settingsSlice.test.ts`, `closeTabFlow.test.ts`, `editorSearchOps.test.ts`, `registry.test.ts` |
| Settings UI | `SettingsDialog.svelte`, new `components/settings/*` |
| App shell | `+page.svelte`, new `AppShell.svelte`, `appShellEffects.ts`, `workspaceContextMenuController.ts` |
| State | `documentTabsSlice.ts`, `documentContentSlice.ts`, `tabTransferSlice.ts`, `settingsSlice.ts`, `chatStore/threads.ts` |
| Domain | `contracts.ts`, new `domain/*.ts` |
| Commands | `registry.ts`, `definitions.ts`, `handlers/*.ts` |
| Services | `chatPersistence.ts`, `sendChatMessage.ts`, `appMenu.ts`, `externalFileChanges.ts`, `sessionManager.ts` |
| Components | `ChatComposer.svelte`, `EditorSurface.svelte`, `TabBarContextMenu.svelte`, `AgentsSidebar.svelte` |
| Editor helpers | new `editor/editorCommandRunner.ts`, `editor/editorSearchOps.ts` |

## Changelog

| Date | Change |
|------|--------|
| 2026-06-08 | M6 milestone complete — all exit criteria checked; 888 tests, check pass |
| 2026-06-07 | Added M6.1 test-coverage sub-milestone; renamed sub-plans to M6.1–M6.4 numbering |
| 2026-06-07 | Initial M6 execution plan — refactoring audit findings; split into UI, State, Platform sub-plans |
