# Version Control — Manual Test Checklist

**Spec:** [version-control-idea.md](./version-control-idea.md) §7.1  
**Platforms:** macOS and Windows (required before MVP sign-off)  
**Last reviewed:** 2026-07-02

Use a disposable folder as the workspace root. Confirm system `git` is on PATH before starting.

## Setup

- [ ] Open SpecOps and create or open a workspace folder that is **not** yet a git repository.
- [ ] Confirm **Version Control** appears on the workspace context menu (activity rail).
- [ ] Open **Version Control** — tab title reads **Version Control** and is a singleton (re-opening focuses the existing tab).

## Empty states

- [ ] **Git missing:** (optional — rename/move `git` off PATH or use a VM without git) tab explains git is unavailable with install guidance.
- [ ] **Not a repository:** tab shows **Not a git repository** with **Init repository** action.
- [ ] **Init repository:** click **Init repository** — repo created at workspace root; tab transitions to normal VC layout.
- [ ] **Nested workspace:** open a subfolder of an existing repo — VC resolves parent repo root and shows history/changes for the repo.

## History

- [ ] **Commit list:** flat list shows SHA, author, date, subject for current branch.
- [ ] **Commit detail:** select a commit — metadata and changed-files list appear; selecting a file shows an inline unified diff in the right pane.
- [ ] **Binary / large diff:** select a commit that changes a binary file (or a very large text diff) — diff pane shows a clear placeholder instead of garbled text or UI freeze.
- [ ] **Refresh:** toolbar **Refresh** reloads history without errors.

## Branches

- [ ] **Branch list:** local branches shown; current branch marked.
- [ ] **Checkout:** switch to another branch when working tree is clean — history/branches/header update.
- [ ] **Dirty tree block:** modify a tracked file (do not commit) — checkout shows block message; branch does not change.
- [ ] **Create branch:** create a new branch from prompt — new branch checked out and listed.

## Tags

- [ ] **Tag list:** existing tags listed (or empty state).
- [ ] **Create tag:** create a lightweight tag — appears in list and on history decorations when applicable.
- [ ] **Delete tag:** delete a local tag with confirmation — removed from list (`git tag -d` only).

## Changes (stage / commit)

- [ ] **Unstaged list:** modified and untracked files appear under unstaged.
- [ ] **Stage / unstage:** stage one or more files — move to staged; unstage returns them.
- [ ] **Stage all:** stage all unstaged changes.
- [ ] **Commit:** enter message and **Commit** — commit succeeds; staged list clears; history shows new commit.
- [ ] **Empty commit blocked:** commit button disabled when nothing staged or message empty.
- [ ] **Path display:** files in nested folders show forward slashes in UI (no broken `\\` mixes on Windows).

## Remote operations

- [ ] **Upstream display:** when tracking branch exists, ahead/behind counts shown in header.
- [ ] **Fetch:** **Fetch** completes (or shows readable error + stderr in console on failure).
- [ ] **Pull:** **Pull** on clean tree succeeds or shows merge/auth error in toast + console.
- [ ] **Push:** **Push** succeeds when upstream configured, or shows no-upstream / auth message.
- [ ] **Parallel guard:** double-click **Push** (or Fetch/Pull) — only one operation runs; buttons re-enable after completion or error.

## Guards (unsaved editor + read-only)

- [ ] **Unsaved documents:** open a file, edit without saving — checkout / pull / create branch blocked with “N unsaved files” dialog (Cancel only).
- [ ] **Bare repository:** open a bare repo — read-only banner; stage/commit/pull disabled.
- [ ] **Detached HEAD:** checkout a tag or commit — detached banner visible; read-only history still works; checkout branch allowed when clean.

## Errors and logging

- [ ] **Auth / network failure:** push or pull to unreachable remote — toast with human-readable message; stderr in app console.
- [ ] **No silent failures:** failed git command always surfaces in UI or console.

## OpenCode isolation

- [ ] Disable OpenCode in app settings (or run without sidecar).
- [ ] Version Control tab still probes repo, shows history, and runs stage/commit/checkout.
- [ ] Project tree **M/A/D** badges (OpenCode `file.status`) may still appear — that is expected and separate from VC.

## Sign-off

| Platform | Tester | Date | Pass |
|---|---|---|---|
| macOS | | | [ ] |
| Windows | | | [ ] |

When both platform rows pass, record MVP sign-off in `specs/changelog.md`.
