# D-07 Task 1 — Stash core git service operations [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-07](../backlog.md) — Stash → checkout flow  
**Spec:** [version-control-idea.md](../version-control-idea.md) §3 #11  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 7 · **Agent:** medium · **Estimate:** ~0.75d

## Goal

Implement foundational stash operations in git service so checkout flows can temporarily park local changes when the user opts in.

## Required context

1. Existing git mutation API: `app/src/lib/git/gitService.ts`
2. Checkout guard behavior: `app/src/lib/services/unsavedDocumentGuard.ts`, `GitBranchesPanel.svelte`
3. Reference stash commands: [`Commands/Stash.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Stash.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Stash.cs)
4. Reference stash listing model: [`Commands/QueryStashes.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryStashes.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryStashes.cs)
5. Reference stash apply/drop actions: [`Views/StashesPage.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/StashesPage.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/StashesPage.axaml)

## Implementation steps

1. Add stash types to `types.ts` (`GitStashSummary`, stash id/ref, message, created-at if available).
2. Implement service methods:
   - `createStash(repoRoot, message?, includeUntracked?)`
   - `queryStashes(repoRoot)`
   - `applyStash(repoRoot, stashRef, pop?)`
3. Parse stash list output into typed rows with stable ordering.
4. Add explicit error mapping for apply conflicts / missing stash refs.
5. Add tests for command argv, parse behavior, and conflict error paths.

## Acceptance checklist

- [ ] Stash create/query/apply APIs are available from `gitService.ts`.
- [ ] Service handles empty stash list and malformed lines without crashing.
- [ ] Apply conflict returns a typed error for UI mapping.
- [ ] Tests cover both mocked and `describeIfGitInstalled` happy path.

## Dependencies

- Existing checkout operation in branches panel

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
