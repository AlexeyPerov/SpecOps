# D-09 Task 1 — Workspace Manager git column foundation

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-09](../backlog.md) — Workspace Manager git column  
**Spec:** [version-control-idea.md](../version-control-idea.md) §3 #16  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 6 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Add a first-pass Git column in Workspace Manager that surfaces repository state summary and can be refreshed independently of the Version Control tab.

## Required context

1. Workspace Manager table components and row model (`app/src/lib/components/...`)
2. Existing git probe/status summary APIs (`versionControlProbe.ts`, `queryRepositoryStatusSummary`)
3. Existing workspace-level refresh mechanisms
4. Reference repository list presentation: [`Views/Launcher.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/Launcher.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/Launcher.axaml)
5. Reference repository node model: [`ViewModels/Launcher.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/ViewModels/Launcher.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/ViewModels/Launcher.cs)

## Implementation steps

1. Add Workspace Manager column rendering compact git state cell:
   - branch name (or detached)
   - ahead/behind if available
   - dirty/clean marker
2. Add lazy fetch behavior so git summary loads on visible rows and refresh command.
3. Handle non-git workspaces with neutral placeholder.
4. Reuse existing git command throttle/busy patterns to avoid parallel overload.
5. Add tests for row rendering states and probe failures.

## Acceptance checklist

- [ ] Workspace Manager shows git info for git-backed workspaces.
- [ ] Non-git workspaces render an explicit neutral value, not errors.
- [ ] Refresh updates git column without requiring tab switch.
- [ ] Probe failures do not break table rendering.

## Dependencies

- VC MVP probe/status services complete

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
