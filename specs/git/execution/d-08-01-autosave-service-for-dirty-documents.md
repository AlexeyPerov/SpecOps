# D-08 Task 1 — Autosave service for dirty documents

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-08](../backlog.md) — Auto-save dirty docs before git ops  
**Spec:** [version-control-idea.md](../version-control-idea.md) §3 #12  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 6 · **Agent:** medium · **Estimate:** ~0.5d

## Goal

Add a reusable pre-git-operation autosave utility that attempts to save dirty editor buffers for the active workspace and reports save failures deterministically.

## Required context

1. Dirty-doc guard: `app/src/lib/services/unsavedDocumentGuard.ts`
2. Editor state/store modules used by save actions (current editor write path)
3. Git operation entry points in `VersionControlView.svelte` and branch/change panels
4. Reference local-changes safety UX concepts: [`Views/DealWithLocalChangesMethod.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/DealWithLocalChangesMethod.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/DealWithLocalChangesMethod.axaml)
5. Reference command safety orchestration style: [`ViewModels/Repository.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/ViewModels/Repository.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/ViewModels/Repository.cs)

## Implementation steps

1. Create `preGitAutosave.ts` service with:
   - `autosaveWorkspaceDirtyDocuments(workspaceId, options?)`
   - result type including saved count, skipped docs, and failures
2. Reuse existing save mechanism rather than duplicating file-write logic.
3. Provide opt-out mode for operations where autosave is not desired (future settings toggle).
4. Return structured failure details so callers can decide block-vs-warn behavior.
5. Add tests with mocked dirty docs and failing save path.

## Acceptance checklist

- [ ] Autosave service saves dirty docs in deterministic order and returns summary.
- [ ] Save failures are reported without throwing uncaught errors.
- [ ] No-op when there are no dirty docs.
- [ ] Unit tests cover success, partial failure, and total failure.

## Dependencies

- Existing editor save APIs and dirty-document index

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
