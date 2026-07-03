# D-04 Task 2 — Push tag mutation [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-04](../backlog.md)  
**Prior task:** [d-04-01-query-remotes-service.md](./d-04-01-query-remotes-service.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 6 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Implement `pushTag` gitService mutation pushing a single tag ref to a chosen remote, with network error surfacing consistent with fetch/pull/push.

## Required context

1. `queryRemotes`, `pushRemote`, `versionControlRemoteOps.ts` busy guards
2. Reference push ref: [`Push.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Push.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Push.cs) — `Push(repo, remote, refname, isDelete)` constructor
3. Reference ViewModel flow: [`PushTag.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/ViewModels/PushTag.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/ViewModels/PushTag.cs) — `refs/tags/{name}`

## Implementation steps

1. Implement `pushTag(repoRoot, remoteName, tagName)`:
   - Command: `git push <remote> refs/tags/<tagName>` (no `--delete`, no `--tags` all-tags flag).
   - Validate tag name via existing `validateGitRefName`.
   - Validate remote exists via `queryRemotes` or let git fail with mapped error.
2. Integrate with `canStartRemoteGitOperation` / toolbar busy if invoked from VC header context; tag panel may use local `actionBusy` only.
3. On success, return void; caller refreshes tag list.
4. Map errors: auth failure, remote rejected, tag already exists on remote (non-fast-forward) — use `formatGitErrorPrimaryMessage`.
5. Unit test argv construction; integration test optional with mock remote or skip.

## Acceptance checklist

- [ ] Push tag succeeds against local bare remote in integration test (`describeIfGitInstalled`) OR documented manual verification in changelog.
- [ ] Invalid remote/tag names rejected before git call.
- [ ] Stderr logged on failure per phase 4 conventions.

## Dependencies

- [d-04-01-query-remotes-service.md](./d-04-01-query-remotes-service.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
