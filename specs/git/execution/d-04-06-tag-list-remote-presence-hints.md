# D-04 Task 6 — Tag list remote presence hints

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-04](../backlog.md)  
**Prior task:** [d-04-04-push-tag-dialog-ui.md](./d-04-04-push-tag-dialog-ui.md), [d-04-05-delete-tag-remote-checkbox-flow.md](./d-04-05-delete-tag-remote-checkbox-flow.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 5 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Show lightweight indicators in the tag list for whether a tag appears to exist on the default remote (post-fetch), helping users decide when to push or remote-delete.

## Required context

1. `GitTagsPanel.svelte`, `queryTags`
2. `queryRemotes`, existing fetch/pull refresh hooks
3. Reference tags view: [`TagsView.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/TagsView.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/TagsView.axaml)
4. Reference tag query: [`QueryTags.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryTags.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryTags.cs)

## Implementation steps

1. Implement `queryRemoteTags(repoRoot, remoteName)`:
   - `git ls-remote --tags <remote>` or `git ls-remote --refs <remote> refs/tags/*`
   - Parse tag names (strip `refs/tags/` prefix); dedupe peeled `^{}` lines.
2. Extend tag list model with optional `onRemote?: boolean` for default remote (`origin` if exists, else first remote).
3. After tag list load (and after fetch mutation refresh), load remote tag names once per refresh token; mark intersection locally.
4. UI: small badge or icon “remote” on tag row when `onRemote`; tooltip “Present on origin” (use actual remote name).
5. When no remotes or ls-remote fails (offline), hide badges gracefully — no error toast on background probe failure (console diagnostic only).

## Acceptance checklist

- [ ] After fetch, tag pushed to origin shows remote indicator.
- [ ] Local-only tag has no remote indicator.
- [ ] Offline ls-remote failure does not break tag list.
- [ ] Parser tests for ls-remote fixture stdout.

## Dependencies

- [d-04-01-query-remotes-service.md](./d-04-01-query-remotes-service.md)
- [d-04-04-push-tag-dialog-ui.md](./d-04-04-push-tag-dialog-ui.md)

## D-04 exit criteria

- [ ] Users can push a tag to a remote and delete tags locally + on remotes.
- [ ] Tag list hints show remote presence after fetch.
- [ ] All D-04 tasks marked `[DONE]`.

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
