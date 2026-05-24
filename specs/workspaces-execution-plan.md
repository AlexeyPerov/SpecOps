# Workspaces — Execution Plan

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task. Behavior and scope come from `specs/workspaces-milestone-plan.md` (source of truth).

## Assumptions

- Implementation is agent-only; human role is approval/review.
- Workspaces extend the existing SpecOps app in `<root>/app/` (Tauri v2 + Svelte 5 + CodeMirror 6).
- No session v1 migration shim — bump snapshot version; dev users may reset `session.json`.
- Nucleus (`references/Nucleus/`) is read-only reference material for Milestone 4 UI; do not modify or copy Tauri v1 / Svelte 4 APIs verbatim.
- Multi-window remains Notepad-only; workspace editing is single-window.
- Tree context menus, drag-and-drop in tree, and watcher-driven tree refresh are post-v1 (see milestone plan follow-ups).

## Confidence and Risks

Confidence: Medium.

Resolved constraints:

1. Product behavior is fully specified in `specs/workspaces-milestone-plan.md`.
2. Existing services (`folderOpenableFiles`, `openActivePath`, open-file registry, `appMenu`) provide patterns for M3–M4.
3. Nucleus file tree offers a concrete UI port target for M4.

Implementation decisions (formerly open uncertainties):

1. **Editor chrome (hybrid)** — Window-shared: `zoomPercent`, `wrapLines`. Reset on context switch: `findReplaceOpen`, `goToOpen`, `previewMode`, `markdownViewMode`, console. See milestone plan *Editor chrome*.
2. **Dirty prompts** — Prompts only on destructive discard (`closeTab*`, `closeWorkspace`, quit). `switchContext`, routing, and tab moves never prompt. **`closeWorkspace`** uses a **batched dialog** (Save All / Discard All / Cancel). See milestone plan *Context switch and dirty prompts*.
3. **Layout** — **ResizeObserver** + ordered collapse (project panel → console → editor floor). Markdown split auto-fallback to edit-only when too narrow. See milestone plan *Responsive layout*.
4. **Session size** — v1 persists full document content as today. Optional **M5-5**: strip redundant `savedContent` for clean on-disk files when serializing.

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog entry.

## Milestone Overview

| Milestone | Tasks | Depends on |
|---|---|---|
| M1 — Foundation and naming | M1-1 … M1-5 | — |
| M2 — Activity rail | M2-1 … M2-5 | M1 |
| M3 — File routing | M3-1 … M3-5 | M2 |
| M4 — Project panel | M4-1 … M4-6 | M2 (M3 recommended before release) |
| M5 — Console, layout, polish | M5-1 … M5-5 | M3, M4 |

---

## Milestone 1 — Foundation and naming

#### Task M1-1: Naming cleanup [Score:3] [Agent:easy] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Naming section)
2. `app/src/lib/state/appState.ts`, `app/src/routes/+page.svelte`

- Rename `appState.resetWorkspace()` → `resetAppState()`; update all call sites (tests, services).
- Rename CSS `.workspace` → `.editor-pane`, `.markdown-workspace` → `.markdown-layout` in `+page.svelte`.
- Grep for stale “workspace” layout references; ensure user-facing “Workspace” copy is reserved for the new feature.

**Acceptance checklist**

- `npm test` passes after rename.
- No remaining `resetWorkspace` or layout `.workspace` class in app source.
- `npm run check` passes.

Dependencies: none.

---

#### Task M1-2: Domain types and contracts [Score:5] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (State model, Session persistence)
2. `app/src/lib/domain/contracts.ts`

- Add types: `ContextId`, `WorkspaceContext`, `WorkspaceEntry`, `ContextSnapshot`, `WindowContextState` (or equivalent names per milestone naming table).
- Extend `WindowSessionSnapshot` / session codec types for v2: `activeContextId`, `notepad`, `workspaces[]`, `editorPreferences: { zoomPercent, wrapLines }`.
- Bump `AppSessionSnapshot` version field (v2); document no migration in code comment only.
- Add command ids: `workspace.add`, `workspace.close` to `AppCommandId`.

**Acceptance checklist**

- Types compile; no breaking change to unrelated exports without follow-up tasks.
- Session v2 shape documented in types matches milestone conceptual model.

Dependencies: M1-1.

---

#### Task M1-3: Context-aware appState core [Score:9] [Agent:heavy] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Contexts and tabs, Editor chrome)
2. `app/src/lib/state/appState.ts`, `app/src/lib/state/appState.test.ts`

- Restructure store: notepad context + workspace map/list + `activeContextId`.
- Refactor existing tab/document reducers to operate on **active context** (createTab, openFileInTab, closeTab, selectTab, etc.).
- Expose selectors/helpers: `getActiveContext()`, `getActiveDocuments()`, `getActiveSession()`, `isNotepadActive()`, `getWorkspaceRoot(activeId)`.
- Preserve current default: single notepad context with one untitled tab on fresh state.
- **Editor chrome (hybrid):** keep `zoomPercent` + `wrapLines` window-shared on `AppDomainState.editor`; on `switchContext`, reset `findReplaceOpen`, `goToOpen`, `previewMode` to defaults (find/go closed, preview `"editor"`).

**Acceptance checklist**

- Existing app behavior unchanged when no workspaces are added (notepad-only path).
- Unit tests updated; all prior `appState` tests pass or are intentionally migrated.
- Active context drives tab bar data in a minimal dev wiring or test harness.
- Context switch clears find/go/preview state; zoom/wrap unchanged across switch.

Dependencies: M1-2.

---

#### Task M1-4: Workspace lifecycle reducers [Score:7] [Agent:heavy] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Close workspace, Duplicate workspaces, Re-add, Context switch and dirty prompts)
2. `app/src/lib/services/diskFingerprint.ts` (`normalizePathSync`)

- Implement `switchContext(id)`, `addWorkspace(rootPath)`, `closeWorkspace(id)`.
- Duplicate guard: reject normalized path already in rail.
- **`switchContext`:** never call dirty `confirm` — only reset transient UI (via M1-3).
- **`closeWorkspace`:** if any dirty docs in that context, show **batched dialog** — **Save All** (workspace tabs) / **Discard All** / **Cancel**; on confirm remove from list, switch to Notepad, discard snapshot.
- `addWorkspace`: fresh empty context (one untitled tab or empty tab set per product default — match notepad empty behavior).
- Pure helpers testable without UI: `findWorkspaceByPath`, `isPathUnderWorkspaceRoot(path, root)`.

**Acceptance checklist**

- Unit tests: tab isolation across switch; duplicate path rejected; close removes workspace.
- `switchContext` with dirty tabs in inactive context does not prompt.
- Batched close-workspace dialog tested with mock confirm/save callbacks.

Dependencies: M1-3.

---

#### Task M1-5: Session snapshot v2 persistence [Score:7] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Session persistence)
2. `app/src/lib/services/sessionManager.ts`, `app/src/lib/services/sessionManager.test.ts`

- Update `toWindowSnapshot` / restore paths for v2 context layout.
- Persist: `activeContextId`, notepad snapshot, ordered workspaces with root paths and per-workspace snapshots, `editorPreferences: { zoomPercent, wrapLines }`.
- Restore: rebuild contexts; counters for doc/tab ids; fall back to fresh notepad if corrupt; do not restore find/go/preview open state.
- Global `recentFiles` and `openFileRegistry` unchanged.
- v1: full document `content` / `savedContent` per tab (see M5-5 for optional lean encoding).

**Acceptance checklist**

- Round-trip test: notepad + one workspace + tabs in each + active workspace selected; zoom/wrap restored.
- Old v1 session file ignored or replaced without crash (no migration — fresh/default ok).

Dependencies: M1-4.

---

## Milestone 2 — Activity rail and workspace lifecycle

#### Task M2-1: ActivityRail component [Score:6] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Activity rail, Layout)
2. `app/src/lib/styles/tokens.css`, `references/Nucleus/src/lib/Sidebar.svelte` (square-button UX reference only)

- Create `ActivityRail.svelte` + `.activity-rail` styles (token-driven).
- Buttons: Notepad (always first), one per workspace (folder icon, basename tooltip), **+** at bottom.
- Visual active state for selected context.
- Right-click on workspace button dispatches close intent (menu implementation in M2-3).

**Acceptance checklist**

- Rail renders with zero workspaces (Notepad + + only).
- Active context visually indicated.
- Meets token styling; no hardcoded palette.

Dependencies: M1-5.

---

#### Task M2-2: Add workspace command and folder picker [Score:5] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Activity rail, Duplicate workspaces)
2. `app/src/lib/commands/registry.ts`, `app/src/lib/services/fileSystem.ts`

- Register `workspace.add` in command registry and `commandDefinitions`.
- **+** rail button and **File → Add Workspace** menu item invoke `workspace.add`.
- Folder picker (Tauri dialog); on confirm call `addWorkspace(normalizedPath)`.
- Notify on duplicate rejection.

**Acceptance checklist**

- User can add workspace from rail and File menu.
- Same folder twice shows error/notify; not duplicated in rail.

Dependencies: M2-1.

---

#### Task M2-3: Close workspace UI [Score:5] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Close workspace, Activity rail context menu, Context switch and dirty prompts)
2. `app/src/lib/components/TabBar.svelte` (in-app context menu pattern)

- Register `workspace.close` command.
- Right-click workspace rail button → **Close Workspace** (custom flyout, not native OS menu).
- Wire **batched** dirty dialog (Save All / Discard All / Cancel); call `closeWorkspace(id)` on proceed; land on Notepad.
- Notepad button: no context menu.

**Acceptance checklist**

- Close removes workspace from rail after confirm/clean close.
- Dirty docs prompt; cancel aborts close.

Dependencies: M2-2.

---

#### Task M2-4: Shell layout and context binding [Score:7] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Layout)
2. `app/src/routes/+page.svelte`

- Integrate `ActivityRail` into main shell grid (left column).
- Bind `TabBar`, `EditorSurface`, status path to **active context** documents/session.
- Rail click → `switchContext(id)` (no dirty prompts).
- On context switch: close console, reset `markdownViewMode` to `edit` (console fully wired in M5-1).

**Acceptance checklist**

- Switching Notepad ↔ workspace swaps tab sets and editor content.
- Layout matches milestone ASCII diagram (rail + editor; project panel slot reserved for M4).

Dependencies: M2-3.

---

#### Task M2-5: Hide activity rail setting [Score:4] [Agent:easy] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Hide rail when Notepad-only)
2. `app/src/lib/domain/contracts.ts` (`AppSettingsState`), settings pane in `+page.svelte`

- Add setting: `hideActivityRailWhenNotepadOnly` (default **on**).
- Persist via existing settings store.
- When enabled and `workspaces.length === 0`, hide entire rail.
- **File → Add Workspace** remains available when rail hidden.

**Acceptance checklist**

- Setting toggles rail visibility without restart.
- Adding first workspace shows rail (when workspaces exist, rail visible regardless of setting).

Dependencies: M2-4.

---

## Milestone 3 — File routing and Notepad-only commands

#### Task M3-1: Path-under-root helpers and Notepad redirect [Score:6] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (File opening and routing)
2. `app/src/lib/services/diskFingerprint.ts`

- Implement `isPathUnderRoot(filePath, workspaceRoot)` using normalized paths.
- Implement `ensureNotepadForOutsidePath(path)` (or equivalent): if active workspace and path outside root → `switchContext('notepad')` then open in notepad context.
- Unit tests for edge cases: root itself, nested paths, trailing slashes, case on macOS.

**Acceptance checklist**

- Pure helper tests pass.
- Document contract for callers in module header.

Dependencies: M2-5.

---

#### Task M3-2: Notepad-only command gate [Score:5] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Notepad-only commands)
2. `app/src/lib/commands/registry.ts`, `app/src/lib/components/TabBar.svelte`

- Shared helper: `runInNotepadContext(fn)` — if workspace active, `switchContext('notepad')` first (no dirty prompts), then run.
- Apply to: `file.openRecent`, `file.openAllInFolder`, tab **Open All Nearby** / **Open All Nearby** bulk action.
- Tabs opened land in Notepad tab set.

**Acceptance checklist**

- Invoking each command from workspace mode ends in Notepad with files in Notepad tabs.
- Recent list remains global.

Dependencies: M3-1.

---

#### Task M3-3: File → Open, New, Save As routing [Score:7] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (File → Open/New/Save As rows)
2. `app/src/lib/commands/registry.ts`, `app/src/lib/services/fileSystem.ts`

- **File → Open** in workspace: dialog defaults to workspace root; outside path → Notepad redirect (M3-1).
- **File → New** in workspace: new tab in workspace context.
- **Save As** in workspace: default dir workspace root; save outside root → allow save, move tab to Notepad + switch.

**Acceptance checklist**

- Manual/automated tests for each flow.
- No workspace tab retains outside-root `filePath` after Save As outside.

Dependencies: M3-2.

---

#### Task M3-4: Open-file registry across contexts [Score:6] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Open-file registry)
2. `app/src/lib/services/openFileRegistry.ts`, `app/src/lib/services/openActivePath.ts`

- Ensure registry is per-window, one path once, regardless of notepad vs workspace.
- Opening path already open in other context → focus existing tab (may switch context to tab owner).
- Sync registry on context switch and tab close.

**Acceptance checklist**

- Tests: same path in notepad blocks duplicate in workspace and vice versa.
- Focus switches to owning tab’s context.

Dependencies: M3-3.

---

#### Task M3-5: Multi-window Notepad-only policy [Score:5] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Multi-window)
2. `app/src/lib/services/windowManager.ts`, `app/src/lib/commands/registry.ts`

- **New Window** always creates Notepad-only window (no workspace rail state copied).
- **Move Tab to New Window** disabled or blocked for workspace tabs; allowed for Notepad tabs.
- OS open routing: last active window; workspace + outside path → Notepad redirect in that window (M3-1).

**Acceptance checklist**

- Cannot move workspace tab to new window.
- Secondary windows have notepad-only context model.

Dependencies: M3-4.

---

## Milestone 4 — Project panel

#### Task M4-1: Lazy project tree service [Score:6] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Project panel — tree content, loading)
2. `app/src/lib/services/folderOpenableFiles.ts`
3. `references/Nucleus/src/lib/File.ts` (sort/folders-first idea only)

- Create `app/src/lib/services/projectTree.ts` (name may vary).
- Export `loadDirectoryChildren(workspaceRoot, dirPath, { showHidden })` → sorted entries: folders first, then files; alphabetical.
- Apply `shouldSkipDirectoryEntry`, `shouldSkipFileEntry`, `isOpenableFilePath`; respect `showHidden` toggle (dotfiles when on).
- Do not follow symlinks in v1.
- Unit tests mirroring `folderOpenableFiles.test.ts` patterns.

**Acceptance checklist**

- Tests cover skip rules, sort order, showHidden on/off.
- Lazy: one `readDir` per call, no full recursive scan.

Dependencies: M2-5 (M3-4 recommended before user-facing release).

---

#### Task M4-2: Tree icons and node primitives [Score:3] [Agent:easy] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (M4 Nucleus reference table)
2. `references/Nucleus/src/lib/Icons/File.svelte`, `Directory.svelte`

- Add `FileIcon.svelte` and `DirectoryIcon.svelte` (or inline SVG components) — port Nucleus SVGs with `currentColor`.
- Add `--tree-indent` token if needed in `tokens.css`.
- Optional shared `treeDepthStyle(depth)` helper (port `computeTreeLeafDepth` idea without DOM walking).

**Acceptance checklist**

- Icons render in light/dark themes via tokens.
- Indent helper usable from list/node components.

Dependencies: M4-1.

---

#### Task M4-3: ProjectTreeList and ProjectTreeNode [Score:8] [Agent:heavy] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (M4 feature parity table)
2. `references/Nucleus/src/lib/FileTree/FileTreeList.svelte`, `FileTreeNode.svelte`, `FileTreeView.svelte`

- Create `ProjectTreeView.svelte` (root `role="tree"`), `ProjectTreeList.svelte` (folders, recursive), `ProjectTreeNode.svelte` (files).
- Svelte 5 syntax; recursive composition (Svelte 5 self-reference or nested components).
- Folder: single-click expand/collapse; arrow `▶` rotation; in-session expansion map keyed by path.
- File: single-click dispatches `openFile(path)` to parent.
- Row `title={path}` tooltips; `role="group"` on child lists.

**Acceptance checklist**

- Tree renders workspace root children after expand.
- Expand/collapse persists for session until refresh/close workspace.

Dependencies: M4-2.

---

#### Task M4-4: ProjectPanel shell [Score:6] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Project panel layout and chrome)
2. `references/Nucleus/src/lib/SidebarView.svelte`

- Create `ProjectPanel.svelte` + `.project-panel` (~240px fixed width).
- Header: workspace basename (tooltip = full root path), **Refresh**, **Show hidden files**, **Collapse** toggle.
- Scroll body wraps `ProjectTreeView`.
- Collapsed state persisted in window session (M1-5 shape).
- Hidden entirely when Notepad active or panel collapsed.

**Acceptance checklist**

- Panel only visible in workspace mode.
- Refresh re-loads expanded folders’ children.
- Collapse hides panel body; state survives restart (after M5-3 integration).

Dependencies: M4-3.

---

#### Task M4-5: Tree open/focus and active-file sync [Score:7] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Click file, Active file)
2. `app/src/lib/services/openActivePath.ts`

- Wire file click → `openActivePath(path, windowId)` in workspace context.
- If path already open anywhere in window → switch to owning context/tab.
- Highlight tree node matching `activeDocument.filePath`; expand ancestors; `scrollIntoView`.
- All tree paths under workspace root only (loader constraint).

**Acceptance checklist**

- Single click opens/focuses tab.
- Active tab change updates tree selection.

Dependencies: M4-4, M3-4.

---

#### Task M4-6: Shell layout integration [Score:5] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Layout)
2. `app/src/routes/+page.svelte`

- Add right column for `ProjectPanel` in middle shell row (rail | editor | project panel).
- Pass active workspace root and collapse state from store/session.
- Markdown split and diff modes remain usable with panel open.

**Acceptance checklist**

- Full M4 exit criteria from milestone plan met in manual smoke pass.
- Project panel hidden in Notepad.

Dependencies: M4-5.

---

## Milestone 5 — Console, layout, and session polish

#### Task M5-1: Console close on context switch [Score:3] [Agent:easy] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Console)
2. `app/src/routes/+page.svelte`, `app/src/lib/components/ConsolePanel.svelte`

- On `switchContext` (rail or routing-induced): set `consoleOpen = false`.
- Global `appConsole` log unchanged; no per-context buffers.
- Verify lazy mount still works after close.

**Acceptance checklist**

- Console closes on every Notepad ↔ Workspace switch.
- Console not persisted across launch (existing behavior).

Dependencies: M2-4, M4-6.

---

#### Task M5-2: Responsive narrow-window layout [Score:5] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Responsive layout)
2. `app/src/lib/styles/tokens.css`

- Add layout tokens: `--editor-min-width` (~400px), `--activity-rail-width`, `--project-panel-width` (if not already).
- **ResizeObserver** on shell middle row with breakpoints (starting points: collapse project panel &lt; ~1100px; auto-close console &lt; ~900px when panel already collapsed).
- Collapse order: (1) project panel, (2) console, (3) never shrink editor below `--editor-min-width`.
- **Markdown split fallback:** when split cannot fit, force `markdownViewMode = "edit"` until width recovers.
- Do not auto-hide activity rail when workspaces open.

**Acceptance checklist**

- Narrow window: project panel collapses before console closes.
- Editor remains editable at `--editor-min-width`.
- Markdown split at 1000×700 with workspace + console: falls back to edit-only or panel/console collapsed without broken layout.

Dependencies: M5-1.

---

#### Task M5-3: End-to-end session restore [Score:6] [Agent:medium] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Session persistence)
2. `app/src/lib/services/sessionManager.ts`

- Verify cold start restores: active context, workspace list order, per-context tabs, project panel collapsed.
- Integration test or documented manual checklist in changelog/spec.
- Fix gaps found in M1-5 persistence vs UI bindings.

**Acceptance checklist**

- Quit/relaunch with two workspaces + notepad tabs restores correctly.
- Project panel collapsed state restored.

Dependencies: M5-2.

---

#### Task M5-5: Lean session snapshot encoding (optional) [Score:4] [Agent:medium]

**Required context**

1. `specs/workspaces-milestone-plan.md` (Session persistence — snapshot size)
2. `app/src/lib/services/sessionManager.ts`

- When serializing `ContextSnapshot.documents`, for tabs with `filePath` set, `!isDirty`, and valid on-disk file: omit redundant `savedContent` (keep `content` or reload from disk on restore — pick one strategy and test).
- Restore path must rehydrate omitted fields (read file from disk or treat `content` as authoritative).
- Log diagnostic when session JSON exceeds a soft size threshold (e.g. 2 MB); no user-facing cap in v1.

**Acceptance checklist**

- Round-trip test: clean saved files restore correctly after lean serialize.
- Dirty and untitled documents still fully persisted.
- Smaller `session.json` for many-tab / many-workspace fixtures in test.

Dependencies: M5-3. **Optional** — not required for Workspaces v1 ship; run after M5-4 if time permits.

---

#### Task M5-4: Validation and documentation [Score:4] [Agent:easy] [DONE]

**Required context**

1. `specs/workspaces-milestone-plan.md` (full doc)
2. `specs/archive/unit-tests.md` (test workflow)

- Run `npm test`, `npm run check`.
- Manual smoke checklist: add/switch/close workspace, tree open, Notepad-only commands from workspace, New Window, narrow layout.
- Update `specs/changelog.md` with feature summary.
- Mark completed tasks `[DONE]` in this file.

**Acceptance checklist**

- All M1–M5 core task checklists satisfied (M5-5 optional).
- Changelog entry for Workspaces v1 ship.

Dependencies: M5-3.

---

## Task dependency graph (summary)

```
M1-1 → M1-2 → M1-3 → M1-4 → M1-5
                              ↓
                    M2-1 → M2-2 → M2-3 → M2-4 → M2-5
                              ↓                    ↓
                    M3-1 → … → M3-5          M4-1 → … → M4-6
                              ↓                    ↓
                              └──────────► M5-1 → M5-2 → M5-3 → M5-4
                                                    └→ M5-5 (optional)
```

M4 may start after M2-5; complete M3 before treating Workspaces as release-ready.

---

## Testing map

| Task | Primary tests |
|---|---|
| M1-4, M1-5 | `appState.test.ts`, `sessionManager.test.ts` |
| M3-1 | New `workspacePaths.test.ts` (or colocated) |
| M3-2, M3-4 | `registry.test.ts`, command handler tests |
| M4-1 | `projectTree.test.ts` |
| M5-3 | Session round-trip + manual smoke |
| M5-5 | `sessionManager.test.ts` lean encode/decode (optional) |

See `specs/archive/unit-tests.md` for Vitest conventions and module reset hooks (`resetAppState` after M1-1).
