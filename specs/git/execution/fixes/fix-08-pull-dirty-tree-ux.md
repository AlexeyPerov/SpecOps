# FIX-08 — Pull dirty-tree UX [DONE]

**Priority:** P2 · **Score:** 5 · **Agent:** medium · **Estimate:** ~0.5d

**Source:** Git integration code review (2026-07-04)  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

`VersionControlView.handlePull` blocks pull whenever `isWorkingTreeDirty` is true. Git CLI often allows pull with local changes depending on merge strategy, autostash, or rebase settings. Users familiar with CLI git may find the hard block surprising.

## Goal

Improve pull UX when the working tree is dirty: clearer messaging and optional safe paths (stash-and-pull or continue when git would succeed).

## Required context

1. `app/src/lib/components/VersionControlView.svelte` — `handlePull`
2. `app/src/lib/git/gitService.ts` — `createStash`, `isWorkingTreeDirty`, `pullRemote`
3. `app/src/lib/services/localChangesCheckoutPrompt.ts` — existing dirty-tree dialog pattern
4. Prior stash work: [d-07-02-stash-checkout-deal-with-local-changes-flow.md](../d-07-02-stash-checkout-deal-with-local-changes-flow.md)

## Implementation steps

1. Product decision (document in plan or spec note):
   - **Option A:** Keep block but improve copy (explain why, link to stash/commit).
   - **Option B:** Offer “Stash and pull” using existing stash service + pull + optional stash pop prompt.
   - **Option C:** Attempt pull and surface git’s own error if unsafe (closest to CLI).
2. Implement chosen option in `handlePull` after pre-git autosave guard.
3. Reuse `prepareWorkspaceForGitOperation` before any stash/pull path.
4. Handle stash/pop failure independently with toasts (mirror branches panel).
5. Extend manual test checklist — pull with dirty tree flows.

## Acceptance checklist

- [x] Dirty-tree pull behavior is documented in UI copy and manual test checklist.
- [x] User has at least one actionable path forward (stash, commit, or cancel).
- [x] Pre-git autosave still runs before pull/stash.
- [x] No silent data loss on failed stash or conflict during pull.

## Dependencies

- FIX-01 recommended (autosave before any stash triggered from pull flow)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
