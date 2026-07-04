# FIX-12 — [DONE] Stash panel UI

**Priority:** P2 · **Score:** 5 · **Agent:** medium · **Estimate:** ~0.75d

**Source:** Git integration code review (2026-07-04)  
**Prior work:** [d-07-01-stash-core-git-service-operations.md](../d-07-01-stash-core-git-service-operations.md)  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

Stash service APIs exist (`createStash`, `queryStashes`, `applyStash`) and are used in checkout-with-dirty-tree flow, but there is **no dedicated stash UI** — users cannot list, apply, or drop stashes from the Version Control tab.

## Goal

Add a Stashes section (or sub-panel) to Version Control for list, apply, and drop operations.

## Required context

1. `app/src/lib/git/gitService.ts` — stash APIs; add `dropStash` if missing (`git stash drop`)
2. `app/src/lib/git/gitParse.ts` — `parseStashList`
3. `app/src/lib/components/VersionControlView.svelte` — section tabs
4. `app/src/lib/components/GitBranchesPanel.svelte` — stash-on-checkout reference UX
5. Backlog §5 stash features for future scope (drop only in v1 of this fix)

## Implementation steps

1. Add `dropStash(repoRoot, ref)` to `gitService.ts` if not present; typed errors for not found.
2. Create `GitStashesPanel.svelte`:
   - List stashes (ref, date, message summary)
   - Apply selected stash (with dirty-tree guard + prompt reuse)
   - Drop selected stash (confirm dialog)
   - Create stash button (optional; or defer to Changes panel)
3. Add “Stashes” to VC section tabs or nested under Branches — pick one layout and document.
4. Wire `readOnly` for bare repos (apply/drop/create disabled).
5. Call `prepareWorkspaceForGitOperation` before apply when it mutates working tree.
6. Tests for panel load/apply/drop error paths; extend manual test checklist.

## Acceptance checklist

- [x] User can view stash list for a repo from Version Control UI.
- [x] Apply stash respects dirty-tree prompts and pre-git autosave.
- [x] Drop stash requires confirmation and refreshes list.
- [x] Bare repository: stash list read-only or hidden with explanation.

## Dependencies

- FIX-01 recommended for apply path autosave

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
