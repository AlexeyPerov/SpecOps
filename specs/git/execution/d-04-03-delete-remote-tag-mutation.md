# D-04 Task 3 — Delete remote tag mutation

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-04](../backlog.md)  
**Prior task:** [d-04-02-push-tag-mutation.md](./d-04-02-push-tag-mutation.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 6 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Delete a tag on a remote via `git push --delete`, composable with existing local `deleteLocalTag` for a combined local+remote delete flow.

## Required context

1. `deleteLocalTag`, `pushTag` from prior tasks
2. Reference remote delete push: [`Push.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Push.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Push.cs) — `isDelete` branch
3. Reference delete tag ViewModel: [`DeleteTag.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/ViewModels/DeleteTag.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/ViewModels/DeleteTag.cs) — local delete then push delete to remotes
4. Reference tag command: [`Tag.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Tag.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Tag.cs) — `DeleteAsync`

## Implementation steps

1. Implement `deleteRemoteTag(repoRoot, remoteName, tagName)`:
   - Command: `git push --delete <remote> refs/tags/<tagName>` (or `git push <remote> :refs/tags/<tagName>` — pick one, document in JSDoc).
2. Implement `deleteTag(repoRoot, tagName, options?: { remoteNames?: string[] })`:
   - Always run local `git tag -d` first (existing function).
   - If `remoteNames` provided, sequentially delete on each remote; collect errors — if local succeeded but remote fails, surface partial success message listing failed remotes.
3. Do not delete remote when `remoteNames` empty/undefined (preserve MVP local-only behavior).
4. Tests: argv builder unit tests; optional bare-remote integration.

## Acceptance checklist

- [ ] Local-only delete unchanged when no remotes passed.
- [ ] Remote delete invoked once per remote in list.
- [ ] Partial failure message is actionable (which remote failed).

## Dependencies

- [d-04-02-push-tag-mutation.md](./d-04-02-push-tag-mutation.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
