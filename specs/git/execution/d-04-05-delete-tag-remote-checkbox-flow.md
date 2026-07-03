# D-04 Task 5 — Delete tag remote checkbox flow

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-04](../backlog.md)  
**Prior task:** [d-04-03-delete-remote-tag-mutation.md](./d-04-03-delete-remote-tag-mutation.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 6 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Extend the existing delete-tag confirmation to optionally delete the tag on one or all remotes, matching reference delete-tag UX at MVP fidelity.

## Required context

1. `GitTagsPanel.svelte` — existing `deleteLocalTag` + `confirm` flow
2. `deleteTag` with `remoteNames` option from task 3
3. `queryRemotes`
4. Reference dialog: [`DeleteTag.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/DeleteTag.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/DeleteTag.axaml)
5. Reference ViewModel: [`DeleteTag.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/ViewModels/DeleteTag.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/ViewModels/DeleteTag.cs) — `PushToRemotes` preference

## Implementation steps

1. Replace plain confirm with custom dialog (native or in-app) containing:
   - Warning text: delete tag `{name}` locally
   - Checkbox: “Also delete from remote(s)” — disabled when no remotes
   - When checked: multi-select or “All remotes” — MVP: push delete to **all** remotes when checked (match reference default `PushToRemotes` behavior)
2. On confirm, call `deleteTag(repoRoot, name, { remoteNames: allRemoteNames })` when checkbox checked; else local only.
3. Show progress/busy on delete button; handle partial remote failures with detailed toast.
4. Refresh tag list via `onMutation` after completion.
5. **Out of scope:** persisting checkbox preference across sessions (reference uses repo UI state) — optional session-only default unchecked.

## Acceptance checklist

- [ ] Unchecked delete behaves as MVP (local only).
- [ ] Checked delete attempts all configured remotes.
- [ ] User sees clear message if remote delete fails but local delete succeeded.
- [ ] Confirmation cannot double-submit while busy.

## Dependencies

- [d-04-03-delete-remote-tag-mutation.md](./d-04-03-delete-remote-tag-mutation.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
