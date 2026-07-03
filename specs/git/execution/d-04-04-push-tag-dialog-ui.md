# D-04 Task 4 — Push tag dialog UI [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-04](../backlog.md)  
**Prior task:** [d-04-02-push-tag-mutation.md](./d-04-02-push-tag-mutation.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 6 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Add **Push tag** action to the Tags panel opening a dialog to pick remote and push the selected local tag.

## Required context

1. `app/src/lib/components/GitTagsPanel.svelte`
2. `queryRemotes`, `pushTag`
3. Reference dialog: [`PushTag.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/PushTag.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/PushTag.axaml)
4. Reference ViewModel: [`PushTag.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/ViewModels/PushTag.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/ViewModels/PushTag.cs) — remote picker, push-all toggle
5. App dialog patterns: `confirm`, `promptEntryName` from existing tags panel

## Implementation steps

1. Add **Push tag** button enabled when a tag is selected, not read-only, and `remotes.length > 0`.
2. On click, load remotes via `queryRemotes`; if none, toast “No remotes configured”.
3. Dialog content:
   - Tag name (read-only label)
   - Remote `<select>` defaulting to first remote or `origin` if present
   - **Optional MVP:** “Push to all remotes” checkbox (mirror reference) — if omitted, document as follow-up in changelog
4. Confirm runs `pushTag`; show busy state; `reportGitError` on failure; toast on success.
5. Disable push when toolbar remote op in flight (reuse `isVersionControlToolbarBusy` if passed as prop from parent).
6. Svelte autofixer clean.

## Acceptance checklist

- [ ] Push tag button visible in Tags panel toolbar/row actions.
- [ ] Dialog lists remotes from `queryRemotes`.
- [ ] Successful push shows success toast; no stale error state.
- [ ] Bare repo / read-only mode disables push.

## Dependencies

- [d-04-01-query-remotes-service.md](./d-04-01-query-remotes-service.md)
- [d-04-02-push-tag-mutation.md](./d-04-02-push-tag-mutation.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
