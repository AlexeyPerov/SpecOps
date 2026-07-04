# FIX-01 — Autosave before working-tree mutations [DONE]

**Priority:** P0 · **Score:** 8 · **Agent:** medium · **Estimate:** ~0.5d

**Source:** Git integration code review (2026-07-04)  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

`prepareWorkspaceForGitOperation` is wired for pull and branch checkout/create, but **`GitChangesPanel` never calls it** before stage, unstage, or commit. A user can edit a file in the editor, stage or commit from the Version Control tab, and git operates on **disk content** while the editor still holds unsaved changes.

## Goal

Ensure all working-tree mutations attempt autosave (and respect the unsaved-document guard) before invoking git, matching pull/checkout behavior.

## Required context

1. `app/src/lib/components/GitChangesPanel.svelte` — stage/unstage/commit handlers
2. `app/src/lib/components/VersionControlView.svelte` — already derives `preGitSaveDeps`; passes them to `GitBranchesPanel` but not `GitChangesPanel`
3. `app/src/lib/services/preGitOperationGuard.ts` — `prepareWorkspaceForGitOperation`
4. Prior work: [d-08-02-autosave-before-git-operations-integration.md](../d-08-02-autosave-before-git-operations-integration.md)

## Implementation steps

1. Add `workspaceRootPath` and `preGitSaveDeps` props to `GitChangesPanel` (mirror `GitBranchesPanel`).
2. Pass props from `VersionControlView.svelte` when rendering `GitChangesPanel`.
3. Call `prepareWorkspaceForGitOperation` at the start of:
   - `handleStageSelected`
   - `handleStageAll`
   - `handleUnstageSelected`
   - `handleCommit`
4. If guard returns `false`, abort without running git (same as branches panel).
5. Extend `preGitOperationGuard.test.ts` or add panel-level tests documenting the new call sites.
6. Extend `specs/git/manual-test-checklist.md` — Changes section: autosave before stage/commit flows.

## Acceptance checklist

- [x] Stage selected, stage all, unstage selected, and commit all call the pre-git guard when deps are available.
- [x] Cancel path never executes git after autosave failure prompt.
- [x] Continue-anyway path still respects unsaved-document guard semantics.
- [x] No regression to pull/checkout/create-branch guard behavior.

## Dependencies

- [d-08-01-autosave-service-for-dirty-documents.md](../d-08-01-autosave-service-for-dirty-documents.md) (complete)
- [d-08-02-autosave-before-git-operations-integration.md](../d-08-02-autosave-before-git-operations-integration.md) (complete)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
