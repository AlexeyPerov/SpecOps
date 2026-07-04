# FIX-05 — Workspace Manager git column refresh

**Priority:** P1 · **Score:** 7 · **Agent:** medium · **Estimate:** ~0.5d

**Source:** Git integration code review (2026-07-04)  
**Prior work:** [d-09-01-workspace-manager-git-column-foundation.md](../d-09-01-workspace-manager-git-column-foundation.md)  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

1. Workspace Manager git cells load on mount/manual refresh only — **no invalidation after VC mutations** (commit, pull, checkout), so branch/dirty/ahead-behind can be stale.
2. `loadWorkspaceGitColumnCellInternal` swallows all errors into a generic `"—"` cell with **no diagnostic log**, unlike VC panels using `reportGitError`.

## Goal

Keep Workspace Manager git column reasonably fresh after git state changes, and log probe failures for diagnostics.

## Required context

1. `app/src/lib/git/workspaceManagerGitColumn.ts`
2. `app/src/lib/components/WorkspaceManagerView.svelte`
3. `app/src/lib/components/VersionControlView.svelte` — `refreshAfterMutation`
4. `app/src/lib/git/versionControlRefresh.ts` — `VersionControlMutationScope`
5. `app/src/lib/services/logging.ts` — `logDiagnostic`

## Implementation steps

1. Add lightweight event or callback channel (e.g. `notifyGitStateChanged(workspaceRootPath, scope?)`) emitted from VC after mutations that change branch or working tree (`commit`, `pull`, `checkout`, `stage` optional).
2. When Workspace Manager is mounted, subscribe and call `loadWorkspaceGitColumnCell(path, { force: true })` for the affected workspace (debounced ~300ms).
3. Optionally refresh active workspace row when VC tab closes if mutation occurred (fallback if event bus not used).
4. Replace bare `catch { return ERROR_CELL }` with `logDiagnostic` including `repoRoot`, operation context, and error message; keep user-facing `"—"` or add tooltip “Could not load git status”.
5. Extend `workspaceManagerGitColumn.test.ts` for error logging and forced refresh after invalidation signal.
6. Manual test checklist — commit in VC tab updates Workspace Manager column without manual Refresh git.

## Acceptance checklist

- [ ] After commit/pull/checkout in VC, Workspace Manager git column for that workspace updates within debounce window.
- [ ] Manual “Refresh git” still works and forces reload.
- [ ] Probe failures log diagnostics; table rendering never breaks.
- [ ] No refresh storm when many workspaces are open (debounce verified).

## Dependencies

- FIX-06 optional (serialization); can ship independently

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
