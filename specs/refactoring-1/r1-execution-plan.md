# Refactoring R1 — App Shell Decomposition (Execution Plan)

How to use this plan: each task lists **Required context** — read only those docs for that task. Scope and goals come from [refactoring-plan.md](./refactoring-plan.md).

**Prerequisite:** R0 complete ([r0-execution-plan.md](./r0-execution-plan.md)) — at minimum required tasks R0-1 through R0-5 and R0-9.

## Assumptions

- AI chat MVP (M6) is complete; no new chat or provider features in this milestone.
- `docs/architecture.md` describes current layering; this milestone changes file layout, not product behavior (except markdown shortcut UX per R1-3).
- Svelte 5 runes migration of `+page.svelte` is **deferred to R3** — R1 may leave `$:` reactive statements in the page.
- Do not add persisted-data migrations.

## Confidence and Risks

Confidence: High.

Resolved constraints:

1. Markdown per-document mode (`markdownViewMode`) already persists in session snapshots.
2. `EditorSurface.svelte`, `markdownPreviewLinks.ts`, and `appState.setDocumentMarkdownViewMode` exist and are tested.

Residual uncertainties:

1. Exact mapping for Cmd+Shift+M after removing global markdown preview — document in R1-3 acceptance checklist.
2. Split-scroll sync behavior must be preserved when moving to `MarkdownEditorPane.svelte`.

## Agent Level Legend

- `easy`: straightforward extraction, clear boundaries.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog entry.

## Milestone exit criteria

- `+page.svelte` script section under ~700 lines.
- Markdown preview uses **only** per-document `markdownViewMode` (no `previewMode === "markdown"` branch).
- `setupRuntime` logic lives in `app/src/lib/services/appShellRuntime.ts` (or equivalent).
- Project tree expansion/loading state lives outside `+page.svelte`.
- `npm test` and `npm run check` pass.

---

## Task breakdown

#### Task R1-1: DocumentEditor wrapper component [Score:3] [Agent:easy] [DONE]

**Required context**

1. [refactoring-plan.md](./refactoring-plan.md) (Dual markdown preview, EditorSurface duplication)
2. `app/src/routes/+page.svelte` (EditorSurface usages)
3. `app/src/lib/components/EditorSurface.svelte`

- Add `app/src/lib/components/DocumentEditor.svelte` that wraps `EditorSurface` with the standard props/callbacks used by the page:
  - `content`, `documentId`, `scrollTop`, `wrapLines`, `zoomPercent`, `language`, `decoratePlaintextSymbols`
  - `onStatusMessage`, `onDocumentDirty` (calls `appState.setDocumentContent` + untitled title refresh hook), `onScrollTopChange`, `registerEditorCommandRunner`
- Accept optional `onUntitledTitleRefresh?: (documentId: string) => void` or callback prop so the page can pass `scheduleUntitledTitleRefresh` without the wrapper importing page locals.
- Replace all three duplicated `EditorSurface` blocks in `+page.svelte` with `DocumentEditor`.

**Acceptance checklist**

- Single component owns EditorSurface wiring for file editing.
- Edit, split, and non-markdown paths behave identically to before.
- No change to editor commands or dirty-state behavior.

Dependencies: none.

---

#### Task R1-2: MarkdownEditorPane component [Score:6] [Agent:medium] [DONE]

**Required context**

1. [refactoring-plan.md](./refactoring-plan.md)
2. `app/src/routes/+page.svelte` (markdown layout block, split scroll sync, `markdownHtml`)
3. `app/src/lib/components/DocumentEditor.svelte` (from R1-1)
4. `app/src/lib/services/markdownPreviewLinks.ts`

- Add `app/src/lib/components/MarkdownEditorPane.svelte` containing:
  - Mode bar (edit / split / preview buttons)
  - Preview-only, split, and edit layouts
  - `{@html markdownHtml}` preview surfaces with `onMarkdownPreviewClick`
  - Split-scroll sync (`setupSplitScrollSync` / `teardownSplitScrollSync` / `syncByRatio`) moved from page
- Props: active document fields, editor preferences, `markdownHtml`, `canFitSplit`, callbacks for mode change and editor runner registration.
- Move `MARKDOWN_SPLIT_MIN_EDITOR_WIDTH` and `canFitMarkdownSplit` logic into the pane or a small helper imported by the pane.
- Page renders `{#if isMarkdownDocument}<MarkdownEditorPane ... />{:else}<DocumentEditor ... />{/if}` when in editor mode.

**Acceptance checklist**

- Markdown edit, split, and preview modes work; split scroll stays in sync.
- Preview link clicks still open files / external URLs correctly.
- Narrow editor width auto-falls back from split to edit (existing behavior).

Dependencies: R1-1.

---

#### Task R1-3: Unify markdown preview modes [Score:5] [Agent:medium] [DONE]

**Required context**

1. [refactoring-plan.md](./refactoring-plan.md) (Dual markdown preview systems)
2. `app/src/lib/commands/registry.ts` (`view.toggleMarkdownPreview`, `view.toggleDiffPreview`)
3. `app/src/lib/state/appState.ts` (`setPreviewMode`, `setDocumentMarkdownViewMode`)
4. `app/src/lib/components/MarkdownEditorPane.svelte` (from R1-2)

- Remove the `state.editor.previewMode === "markdown"` branch and its duplicate preview panel from `+page.svelte`.
- Wire `view.toggleMarkdownPreview` to cycle the **active markdown document's** `markdownViewMode`:
  - Suggested cycle: `edit` → `preview` → `edit` (or `edit` → `split` → `preview` → `edit` if product prefers — pick one and document in task completion note).
  - No-op or status message when active tab is not a markdown file.
- Keep `view.toggleDiffPreview` toggling global diff preview (`previewMode` `"editor"` ↔ `"diff"`) — diff is not per-document today.
- When diff preview is active, markdown mode bar is hidden (same as today).
- Update `appState.test.ts` / any command tests affected by preview behavior.
- Update status-bar notify strings in registry if cycle behavior changes.

**Acceptance checklist**

- Cmd/Ctrl+Shift+M affects markdown view mode on markdown files only.
- No duplicate full-page markdown preview path remains.
- Diff preview (Cmd/Ctrl+Shift+D) unchanged.
- Session restore still restores per-document `markdownViewMode`.

Dependencies: R1-2.

---

#### Task R1-4: DiffPreviewPane component [Score:3] [Agent:easy] [DONE]

**Required context**

1. `app/src/routes/+page.svelte` (diff preview block, `diffLines`, styles)
2. `app/src/lib/domain/contracts.ts` (`DocumentState`)

- Add `app/src/lib/components/DiffPreviewPane.svelte` with saved vs current diff grid.
- Move `diffLines` usage and diff row rendering from page into the component.
- Move diff-related CSS from `+page.svelte` into the component (scoped) or a colocated `.css` module.
- Page uses `{#if state.editor.previewMode === "diff"}<DiffPreviewPane savedContent={...} currentContent={...} />`.

**Acceptance checklist**

- Diff preview visually and functionally matches pre-refactor.
- `marked` / `diffLines` imports removed from `+page.svelte`.

Dependencies: none (can parallel R1-2 after R1-1).

---

#### Task R1-5: Extract appShellRuntime [Score:7] [Agent:heavy] [DONE]

**Required context**

1. [refactoring-plan.md](./refactoring-plan.md)
2. `app/src/routes/+page.svelte` (`setupRuntime`, event listeners, file watcher sync)
3. `app/src/lib/services/sessionManager.ts`
4. `app/src/lib/services/windowManager.ts`
5. `app/src/lib/services/externalFileChanges.ts`

- Create `app/src/lib/services/appShellRuntime.ts` (or `app/src/lib/runtime/appShellRuntime.ts`) exporting something like:

  ```ts
  export async function startAppShellRuntime(options: AppShellRuntimeOptions): Promise<() => void>
  ```

- Move from `+page.svelte` into the module:
  - Settings/theme/GLM key load, chat provider init, logging init
  - Session restore, window bounds apply, open-file registry sync
  - Tauri listeners: drag-drop, file changed, opened paths, activate file, select tab, window destroyed, transfer tab, window ready/resize/move
  - `watchedPathsFromState`, `syncExternalFileWatcher`
  - Initial `take_pending_opened_paths` invoke
- `AppShellRuntimeOptions` includes callbacks: `notify`, `runCommand`, `openAndActivatePath`, `restoreWorkspaceAgentSession`, `scheduleUntitledTitleRefresh`, getters for `currentWindowId`, etc.
- Page `onMount` calls `startAppShellRuntime` and stores cleanup; `runtimeReady` flag can live in page or be returned from runtime start.
- Add focused unit tests for pure helpers (`watchedPathsFromState`) if extracted — **prefer importing from `appShellHelpers.ts` created in R0-2**.

**Acceptance checklist**

- Cold start, session restore, drag-drop open, Finder "Open With", and multi-window tab transfer still work (manual smoke).
- File watcher sync still tracks open file paths.
- `+page.svelte` no longer contains bulk Tauri `listen()` setup.

Dependencies: R1-2, R1-3, R1-4 recommended (smaller page before this task) but not strictly blocking.

---

#### Task R1-6: Project tree controller [Score:5] [Agent:medium] [DONE]

**Required context**

1. `app/src/routes/+page.svelte` (project tree state and reactive loading blocks)
2. `app/src/lib/services/projectTree.ts`
3. `app/src/lib/components/ProjectPanel.svelte`

- Extract project tree UI state and loaders to `app/src/lib/services/projectTreeController.ts` (or `app/src/lib/state/projectTreeStore.ts`):
  - `projectTreeRootNodes`, `projectTreeChildrenByPath`, `projectTreeExpandedPaths`, `projectTreeLoadingPaths`, `projectTreeShowHidden`
  - `loadProjectTreeRoot`, `loadProjectTreeChildren`, `handleToggleProjectTreeDirectory`, `refreshProjectTree`, `expandAncestorsForActiveFile`
  - Reactive "load ancestors when active file changes" logic as a method `ensureExpandedForActiveFile(root, activePath)` called from page `$effect` or explicit subscription
- Page passes controller outputs into `ProjectPanel` as props (same external API as today).
- Add unit tests for path expansion logic (pure functions) — **prefer module from R0-2 / R0-15**.

**Acceptance checklist**

- Project tree lazy-load and expand-on-active-file behavior unchanged.
- Toggle hidden files and refresh still work.
- No project-tree `Map`/`Set` state left in `+page.svelte`.

Dependencies: R1-5 recommended (avoid concurrent large page edits).

---

#### Task R1-7: Shell CSS extraction and validation [Score:3] [Agent:easy] [DONE]

**Required context**

1. `app/src/routes/+page.svelte` (style block)
2. [refactoring-plan.md](./refactoring-plan.md) (exit criteria)

- Move non-trivial layout CSS from `+page.svelte` to `app/src/lib/styles/app-shell.css` (import from page or layout) **or** keep in page if import churn is undesirable — prefer extraction if style block exceeds ~200 lines after prior tasks.
- Run `npm test`, `npm run check`.
- Manual smoke checklist:
  - Markdown edit/split/preview + preview links
  - Diff preview toggle
  - Workspace switch + project tree
  - Console toggle, settings dialog
  - Agent tab + file tab switch
- Verify `+page.svelte` script lines under ~700.

**Acceptance checklist**

- Full test suite and `npm run check` pass.
- Page script line count meets R1 exit criteria.
- Manual smoke items above verified.

Dependencies: R1-1 through R1-6.

---

## Task dependency graph

```
R1-1 ──► R1-2 ──► R1-3
  │
R1-4 (parallel)

R1-1..R1-4 ──► R1-5 ──► R1-6 ──► R1-7
```

## Testing map

| Task | Primary tests |
| --- | --- |
| R1-1 | Manual editor smoke; existing `appState.test.ts` |
| R1-2 | Manual markdown split/preview; `markdownPreviewLinks.test.ts` |
| R1-3 | Update/add command behavior tests; `appState.test.ts` |
| R1-4 | Manual diff smoke |
| R1-5 | `sessionManager.test.ts`, `openFileRegistry.test.ts`, manual multi-window |
| R1-6 | New unit tests for expansion logic; `projectTree.test.ts` |
| R1-7 | Full suite + manual smoke |
