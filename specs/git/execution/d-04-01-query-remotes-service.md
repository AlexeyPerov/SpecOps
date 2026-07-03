# D-04 Task 1 — Query remotes service

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-04](../backlog.md) — Remote tag delete / push tags  
**Spec:** [version-control-idea.md](../version-control-idea.md) §3 #13, §7.3  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 5 · **Agent:** easy · **Estimate:** ~0.5d

## Goal

List configured git remotes with fetch/push URLs so tag push/delete dialogs can target a remote without a full remote-management UI (D-06 remains deferred).

## Required context

1. `app/src/lib/git/gitService.ts`, `gitParse.ts`
2. Existing remote error mappings in `gitErrorUi.ts`
3. Reference remote model: [`Remote.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Remote.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Remote.cs)
4. Reference push tag remote list: [`PushTag.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/ViewModels/PushTag.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/ViewModels/PushTag.cs)

## Implementation steps

1. Add type `GitRemote = { name: string; fetchUrl: string | null; pushUrl: string | null }`.
2. Implement `queryRemotes(repoRoot)` using `git remote -v` stdout parser:
   - Group by remote name; separate fetch vs push URL lines.
   - `(fetch)` and `(push)` suffix handling per git output format.
3. Return sorted by name; empty array when no remotes.
4. Add fixture `git-remote-vv.txt` and parser unit tests.
5. Optional integration test with temp repo + `git remote add origin <url>`.

## Acceptance checklist

- [ ] Parser tests pass on fixture.
- [ ] Repo with no remotes returns `[]` without error.
- [ ] Multiple remotes parsed with distinct fetch/push URLs when they differ.

## Dependencies

- MVP phases 0–3 complete.

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
