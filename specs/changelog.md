# Changelog

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
- **Specs:** Expanded Milestone 4 in `specs/workspaces-milestone-plan.md` with explicit Nucleus reference (`references/Nucleus/`), file-by-file porting guide, and feature parity table for the project panel.

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
