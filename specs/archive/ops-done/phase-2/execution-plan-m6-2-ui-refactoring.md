# M6.2 — Component and app shell refactoring

**Parent:** [execution-plan-m6-refactoring.md](./execution-plan-m6-refactoring.md)  
**Prerequisite:** [M6.1 test coverage](./execution-plan-m6-1-test-coverage.md) complete  
**Parallel with:** [M6.3 State](./execution-plan-m6-3-state-refactoring.md) (after M6.1)

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** in the parent plan applies.

## Goal

Split oversized Svelte components and the app shell route into focused modules without behavior changes.

## Task Breakdown

#### Task 1: SettingsDialog — extract tab panels (P2-10) [Score:9] [Agent:heavy] [DONE]

**Required context**

1. [execution-plan-m6-refactoring.md](./execution-plan-m6-refactoring.md) — RF-3, RF-4
2. [M6.1 Task 7](./execution-plan-m6-1-test-coverage.md) — `settingsPanelActions` tests
3. `app/src/lib/components/SettingsDialog.svelte` — snippets `editorSettingsPanel`, `connectionsSettingsPanel`, `chatModesSettingsPanel`, `debugProviderSettingsPanel`, `logsSettingsPanel`, `providerModelCatalogPanel`
4. `app/src/lib/services/settingsDialogUi.ts`
5. `app/src/lib/components/KeyboardShortcutsSettings.svelte` — existing extraction pattern

- Create `app/src/lib/components/settings/` directory.
- Extract each settings tab snippet into a dedicated component:
  - `EditorSettingsPanel.svelte`
  - `ConnectionsSettingsPanel.svelte` (include `providerModelCatalogPanel` or `ProviderModelCatalogPanel.svelte`)
  - `ChatModesSettingsPanel.svelte`
  - `DebugProviderSettingsPanel.svelte` (shared for debug AI + debug agent scopes via props)
  - `LogsSettingsPanel.svelte`
- Move tab-specific update helpers from `SettingsDialog.svelte` into `settings/settingsPanelActions.ts` (or colocate with the panel that owns them).
- Keep `SettingsDialog.svelte` as shell only: open/close, drag, resize, sidebar, `settingsPanel` router, measurement nodes, dialog chrome styles.
- Pass data and callbacks via props; avoid new global state.

**Acceptance checklist**

- `SettingsDialog.svelte` ≤600 lines.
- Each panel file ≤400 lines.
- All settings tabs behave identically (manual smoke: Editor, Providers, Chat modes, Debug, Logs, Shortcuts).
- M6.1 `settingsPanelActions` tests still pass.
- `npm test` / `npm run check` pass.

Dependencies: M6.1 complete.

---

#### Task 2: SettingsDialog — extract geometry and dialog chrome styles (P2-10) [Score:4] [Agent:easy] [DONE]

**Required context**

1. Task 1 complete
2. `app/src/lib/services/settingsDialogGeometry.ts`
3. `SettingsDialog.svelte` — resize/drag handlers and `<style>` block

- Move remaining drag/resize pointer handlers to `settings/settingsDialogChrome.ts` if still inline.
- Move dialog-specific layout styles to `app/src/lib/styles/settingsDialogChrome.css` (import from shell).
- Ensure measurement hidden panels stay in shell or move to `settings/SettingsDialogMeasure.svelte`.

**Acceptance checklist**

- `SettingsDialog.svelte` ≤450 lines.
- Dialog drag, resize, and center-on-open unchanged.
- No visual regression in settings dialog layout.

Dependencies: Task 1.

---

#### Task 3: +page.svelte — extract AppShell layout component (P2-10) [Score:8] [Agent:heavy] [DONE]

**Required context**

1. `app/src/routes/+page.svelte` — template from `<main class="shell">` through modals/overlays
2. `app/src/lib/styles/app-shell.css`
3. `app/src/lib/services/appShellHelpers.ts`

- Create `app/src/lib/components/AppShell.svelte` containing the shell markup: ActivityRail, AgentsSidebar, TabBar, editor pane routing (ChatPanel, editors, previews), ProjectPanel, ConsolePanel, FindReplacePanel, overlays (ThemePane, SettingsDialog, EntryNamePrompt, workspace context menu).
- `+page.svelte` retains script orchestration initially; passes props and callbacks into `AppShell`.
- Group related props into typed prop objects where it reduces noise (e.g. `projectTree`, `workspaceLayout`).

**Acceptance checklist**

- Template markup largely lives in `AppShell.svelte`.
- `+page.svelte` script still functional; line count reduced by ≥300 from template move.
- App shell layout, tab routing, and panel visibility unchanged.
- `npm test` / `npm run check` pass.

Dependencies: M6.1 complete.

---

#### Task 4: +page.svelte — extract handler modules (P2-10) [Score:8] [Agent:heavy] [DONE]

**Required context**

1. Task 3
2. [M6.1 Task 7](./execution-plan-m6-1-test-coverage.md) — `workspaceContextMenuController` tests
3. `+page.svelte` — handler functions (project tree, agents, workspace menu, layout, commands)
4. `app/src/lib/services/projectTreeController.ts`, `projectFileOps.ts`, `workspaceAgentSession.ts`

- Extract handler groups into focused modules:
  - `app/src/lib/services/appShellProjectTreeHandlers.ts` — load/refresh tree, new file/folder, rename, delete, move, toggle hidden
  - `app/src/lib/services/appShellAgentHandlers.ts` — new/select/delete agent, chat-http tab ensure, restore session
  - `app/src/lib/services/workspaceContextMenuController.ts` — context menu state, close/reorder/move workspace
  - `app/src/lib/services/appShellLayoutHandlers.ts` — responsive layout, panel width, markdown split, console height
- `+page.svelte` wires modules with closures over local state (`notify`, `runtimeReady`, etc.).

**Acceptance checklist**

- `+page.svelte` ≤800 lines after this task (target ≤600 after Task 5).
- All project tree, agent, workspace menu, and layout behaviors unchanged.
- M6.1 workspace context menu tests still pass.
- No new circular imports between services.

Dependencies: Task 3.

---

#### Task 5: +page.svelte — extract reactive side effects (P2-10) [Score:7] [Agent:medium] [DONE]

**Required context**

1. Task 4
2. `+page.svelte` — all `$effect` blocks (~14)
3. `app/src/lib/services/appShellRuntime.ts`, `sessionManager.ts`, `chatAccessMonitor.ts`

- Create `app/src/lib/services/appShellEffects.ts` with named setup functions:
  - `syncAgentTabEffect(...)`
  - `syncSessionPersistenceEffect(...)`
  - `syncSettingsPersistenceEffect(...)`
  - `syncProjectTreeWatcherEffect(...)`
  - `syncChatAccessMonitorEffect(...)`
  - `syncExternalFileWatcherEffect(...)`
  - `syncUntitledTitleEffect(...)`
  - `syncActiveFileTreeExpandEffect(...)`
- Each function accepts dependencies explicitly; `+page.svelte` calls them inside `$effect` blocks (preserves Svelte 5 dependency tracking).
- Document effect ordering constraints in a short comment block at top of `appShellEffects.ts`.

**Acceptance checklist**

- `+page.svelte` ≤600 lines.
- `$effect` count in `+page.svelte` ≤5 (thin wrappers only).
- Persistence, tree sync, agent sync, and settings save side effects unchanged.
- `npm test` / `npm run check` pass.

Dependencies: Task 4.

---

#### Task 6: ChatComposer — extract pickers and send hook (P2-10) [Score:6] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/components/ChatComposer.svelte`
2. `app/src/lib/ai/sendChatMessage.ts`
3. `app/src/lib/ai/modes/resolve.ts`, `app/src/lib/ai/providers/selection.ts`
4. [M6.1 Task 3](./execution-plan-m6-1-test-coverage.md) — `switchThreadConnection` tests

- Extract UI subcomponents:
  - `ChatModePicker.svelte`
  - `ChatConnectionPicker.svelte` (connection + model selection)
- Extract send/retry orchestration to `app/src/lib/ai/useComposerSend.ts` (or `composerSendActions.ts`) — draft clearing, `sendChatMessage` / `retryLastChatTurn`, persistence schedule, error surfacing.
- `ChatComposer.svelte` composes pickers + textarea + submit/retry buttons.

**Acceptance checklist**

- `ChatComposer.svelte` ≤350 lines.
- Send, retry, mode switch, connection switch behavior unchanged.
- Existing composer-related tests pass.

Dependencies: M6.1 complete.

---

#### Task 7: EditorSurface — extract command runner and search ops (P2-10) [Score:6] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/components/EditorSurface.svelte`
2. [M6.1 Task 6](./execution-plan-m6-1-test-coverage.md) — `editorLineOps` / `editorSearchOps` tests
3. `app/src/lib/types/editor.ts`
4. `app/src/lib/editor/searchHighlight.ts`

- Extract `EditorCommandRunner` implementation to `app/src/lib/editor/editorCommandRunner.ts` (undo, indent, move line, duplicate, join, goToLine, zoom, wrap).
- Extract find/replace operations to `app/src/lib/editor/editorSearchOps.ts` (find next/prev, replace, replace all, match info).
- Wire `EditorSurface.svelte` to modules created/tested in M6.1 Task 6.
- `EditorSurface.svelte` owns CodeMirror lifecycle: mount, compartments, extensions, scroll persistence.

**Acceptance checklist**

- `EditorSurface.svelte` ≤350 lines.
- Editor commands and find/replace from UI unchanged.
- M6.1 editor unit tests still pass.
- `editorRouting` / command registry integration still works.

Dependencies: M6.1 Task 6.

---

#### Task 8: TabBarContextMenu and AgentsSidebar (P2-10) [Score:5] [Agent:medium] [DONE]

**Required context**

1. `app/src/lib/components/TabBarContextMenu.svelte`
2. `app/src/lib/components/AgentsSidebar.svelte`
3. [M6.1 Task 5](./execution-plan-m6-1-test-coverage.md) — `closeTabFlow` / `tabContextMenuActions` tests
4. `app/src/lib/services/closeTabFlow.ts`, `nearbyFiles.ts`

**TabBarContextMenu**

- Extract action handlers to `app/src/lib/services/tabContextMenuActions.ts` (rename, reveal, open nearby, close variants, pin if present).
- Keep menu positioning and submenu UI in Svelte component.

**AgentsSidebar**

- Extract drag/resize/collapse controller if inline (mirror `workspaceRailDragController.ts` pattern) to `agentsSidebarController.ts`.
- Extract agent row/list subcomponent `AgentSidebarRow.svelte` if list markup is bulky.

**Acceptance checklist**

- `TabBarContextMenu.svelte` ≤350 lines.
- `AgentsSidebar.svelte` ≤400 lines.
- Tab context menu and agent sidebar behaviors unchanged.
- M6.1 close-tab and context-menu tests still pass.

Dependencies: M6.1 Task 5.

---

## Dependency graph

```text
M6.1 complete → Task 1 → Task 2
M6.1 complete → Task 3 → Task 4 → Task 5
M6.1 complete → Task 6, 7, 8 (Task 7 after M6.1 Task 6; Task 8 after M6.1 Task 5)
```

## M6.2 exit criteria

- [x] All tasks marked `[DONE]`.
- [x] Tier 1 UI files (`SettingsDialog`, `+page`) meet parent M6 line targets.
- [x] Tier 2 components (`ChatComposer`, `EditorSurface`, `TabBarContextMenu`) ≤400 lines each.
- [x] `AgentsSidebar.svelte` ≤400 lines.
- [x] `npm test` / `npm run check` pass.

## Changelog

| Date | Change |
|------|--------|
| 2026-06-07 | Renamed from M6-UI; prerequisite M6.1 added |
| 2026-06-07 | Initial M6-UI sub-plan — settings panels, app shell, composer, editor, tab menu, agents sidebar |
