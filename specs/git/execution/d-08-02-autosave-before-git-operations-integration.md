# D-08 Task 2 — Autosave before git operations integration [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-08](../backlog.md) — Auto-save dirty docs before git ops  
**Prior task:** [d-08-01-autosave-service-for-dirty-documents.md](./d-08-01-autosave-service-for-dirty-documents.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 7 · **Agent:** medium · **Estimate:** ~0.75d

## Goal

Wire autosave into high-impact git operations (checkout, pull, merge/rebase entry points when available) to reduce workflow interruption from unsaved documents.

## Required context

1. `app/src/lib/components/VersionControlView.svelte` remote operations
2. `app/src/lib/components/GitBranchesPanel.svelte` checkout/create operations
3. `app/src/lib/services/preGitAutosave.ts` from Task 1
4. Reference merge/rebase operation UX: [`Views/Merge.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/Merge.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/Merge.axaml)
5. Reference pull flow UX: [`Views/Pull.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/Pull.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/Pull.axaml)

## Implementation steps

1. Call autosave before:
   - pull
   - branch checkout
   - any other operation currently guarded by unsaved-document block
2. If autosave succeeds fully, continue operation silently.
3. If autosave partially fails, show dialog with:
   - failed file list (short form)
   - choice to cancel operation (default) or continue anyway (if safe)
4. Keep current guard as fallback when autosave service unavailable.
5. Extend manual test checklist for autosave success/failure flows.

## Acceptance checklist

- [ ] Pull and checkout attempt autosave before git command starts.
- [ ] Failure UX clearly explains what was not saved.
- [ ] Cancel path never executes git command.
- [ ] Existing busy state and error reporting remain correct.

## Dependencies

- [d-08-01-autosave-service-for-dirty-documents.md](./d-08-01-autosave-service-for-dirty-documents.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
