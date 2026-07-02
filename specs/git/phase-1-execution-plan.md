# Phase 1 Execution Plan — View Tab Shell

**Spec:** [version-control-idea.md](./version-control-idea.md) §8 phase 1  
**Prior:** [phase-0-execution-plan.md](./phase-0-execution-plan.md)  
**Next:** [phase-2-execution-plan.md](./phase-2-execution-plan.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

## Assumptions

- Phase 0 complete: `gitService.ts`, `resolveRepoRoot`, `checkGitAvailable`.
- View tabs follow Workspace Settings pattern (`workspace-settings` kind).
- VC tab is **singleton per workspace session** (not notepad-global).
- Panels in this phase may show placeholders; real data arrives in phase 2.

## Confidence and Risks

Confidence: **High** (mostly plumbing mirroring existing view tabs).

Residual uncertainties:

1. Tab title/icon in `TabBar.svelte` — match existing view-tab conventions.
2. Split-pane active workspace root threading — verify same prop path as `WorkspaceSettingsView`.

## Agent Level Legend

- `easy` / `medium` / `heavy` — see phase 0 plan.

## Changelog Instructions

- Mark tasks DONE in this file; update `specs/changelog.md`.

## Task Breakdown

#### Task 1.1: Widen view-tab domain for `version-control` (G1-1) [Score:5] [Agent:easy] [~0.5d] [DONE]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §4.2
2. `app/src/lib/domain/document.ts`, `documentTabsSlice.ts`, `editorRouting.ts`

- Add `"version-control"` to `ViewTabState.view`, `createViewTab`, `normalizeTabState`, `openOrFocusViewTab`.
- Update `EditorViewKind` comment in `editorRouting.ts`.
- Extend `documentTabsSlice.test.ts` with open/focus singleton test.

**Acceptance checklist**

- `openOrFocusViewTab("version-control")` opens one tab; second call focuses existing.
- `npm test` passes for slice test.

Dependencies: Phase 0 exit criteria.

---

#### Task 1.2: Context menu entry + controller action (G1-2) [Score:5] [Agent:easy] [~0.5d] [DONE]

**Required context**

1. `workspaceContextMenuController.ts` — `openSettings` pattern
2. `AppShell.svelte` workspace context menu markup

- Add `openVersionControl(workspaceId)` mirroring `openSettings`.
- Add menu item **Version Control** (position: after Settings or before Move up).
- Wire through `+page.svelte` props to `AppShell`.

**Acceptance checklist**

- Right-click workspace → Version Control switches context and opens VC tab.
- Menu closes after action.

Dependencies: Task 1.1.

---

#### Task 1.3: VersionControlView shell component (G1-3) [Score:7] [Agent:medium] [~1d] [DONE]

**Required context**

1. `WorkspaceSettingsView.svelte` — sidebar + body layout
2. [version-control-idea.md](./version-control-idea.md) — §4.3 sections

- Create `VersionControlView.svelte` with sidebar tabs: History, Branches, Tags, Changes.
- Accept `workspaceRootPath: string | null`.
- Placeholder body per section (“Coming in phase 2/3”).
- Shared header stub: branch name placeholder, Fetch/Pull/Push disabled until phase 3.

**Acceptance checklist**

- Section switching works locally.
- Matches workspace-settings visual tokens (sidebar width, tab buttons).
- Svelte autofixer / check clean.

Dependencies: Task 1.1.

---

#### Task 1.4: Editor routing + TabBar titles (G1-4) [Score:4] [Agent:easy] [~0.5d] [DONE]

**Required context**

1. `EditorPaneContent.svelte`, `TabBar.svelte`
2. Task 1.3 component

- Render `VersionControlView` when `activeViewTabKind === "version-control"`.
- Pass `workspaceRootPath` from editor chrome props (same as workspace settings).
- Tab strip title/tooltip: **Version Control**.

**Acceptance checklist**

- VC tab renders in editor pane when selected.
- Switching workspaces updates scoped root when VC tab active.

Dependencies: Tasks 1.1, 1.3.

---

#### Task 1.5: Empty states — no git / not a repo (G1-5) [Score:6] [Agent:medium] [~0.5d] [DONE]

**Required context**

1. Task 0.5 `checkGitAvailable`, `resolveRepoRoot`
2. [version-control-idea.md](./version-control-idea.md) — §4.4

- On mount / workspace change: probe git + repo root.
- Show dedicated empty UI when git missing or not a repo (before section sidebar).
- Hide section sidebar until repo is valid (or show disabled overlay).

**Acceptance checklist**

- Non-repo workspace shows explanatory empty state.
- Machine without git shows install hint (platform-aware copy for macOS + Windows).

Dependencies: Tasks 1.3, 1.4, Phase 0.

---

#### Task 1.6: Init repository action (G1-6) [Score:5] [Agent:medium] [~0.5d] [DONE]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §4.4, §6 init
2. Task 1.5 empty state

- Add **Init repository** button on not-a-repo empty state.
- Run `git init` at `workspaceRootPath` via `runGit`; re-probe repo root.
- Confirm dialog before init (creates `.git` at workspace root).

**Acceptance checklist**

- Init on empty folder transitions to valid repo UI (sections visible).
- Init on folder that is nested inside existing repo still resolves to parent via `rev-parse` (no double init confusion — document behavior in UI if parent repo exists).

Dependencies: Task 1.5.

---

## Dependency graph

```text
Task 1.1 → Task 1.2
       → Task 1.3 → Task 1.4 → Task 1.5 → Task 1.6
```

## Phase 1 exit criteria

- [x] Context menu opens singleton VC tab per workspace.
- [x] Empty states for missing git and non-repo workspaces.
- [x] Optional init creates repo at workspace root.
- [x] Section shell ready for phase 2 data wiring.

**Estimate:** ~2.5–3 days
