# D-06 Task 1 — Remote picker state model and persistence [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-06](../backlog.md) — Remote picker for push/pull  
**Spec:** [version-control-idea.md](../version-control-idea.md) §3 #9  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 6 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Introduce a reusable state model for selecting active remotes/branches per operation, with sensible defaults and persistence that does not break current upstream-first flows.

## Required context

1. Existing remote query code: `app/src/lib/git/gitService.ts` (`queryRemotes`)
2. Existing toolbar state: `app/src/lib/components/VersionControlView.svelte`
3. Existing refresh/mutation helper: `app/src/lib/git/versionControlRefresh.ts`
4. Reference remote selection UX patterns: [`ViewModels/Push.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/ViewModels/Push.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/ViewModels/Push.cs)
5. Reference pull/fetch target selection: [`Views/FetchInto.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/FetchInto.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/FetchInto.axaml)

## Implementation steps

1. Add `versionControlRemoteSelection.ts` helper module with:
   - selected remote id
   - optional selected remote branch
   - fallback resolution rules (`origin`, then first remote)
2. Add workspace-scoped persistence key in existing settings store (or VC local state store) for last selected remote per repository.
3. Implement derivation helpers that keep selection valid after remote list refresh (deleted remote fallback).
4. Keep default upstream operation path as fallback when picker is unset or incompatible.
5. Add tests for fallback, persistence restore, and refresh invalidation behavior.

## Acceptance checklist

- [ ] Selected remote survives view reload within the same workspace.
- [ ] If selected remote is removed, selection safely falls back without crash.
- [ ] Current upstream-only behavior remains unchanged when picker is disabled/unset.
- [ ] Unit tests cover selection derivation and persistence serialization.

## Dependencies

- `queryRemotes` from D-04

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
