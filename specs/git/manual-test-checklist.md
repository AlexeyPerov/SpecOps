# Version Control — Manual Test Checklist

**Spec:** [version-control-idea.md](./version-control-idea.md) §7.1  
**Platforms:** macOS, Windows, and Linux (Linux co-equal launch readiness)  
**Last reviewed:** 2026-07-04

Use a disposable folder as the workspace root. Confirm system `git` is on PATH before starting.

## Linux environment matrix

Run these checks once per target Linux environment before manual sign-off. Record results in the sign-off table.

| Check | Ubuntu / Debian | Fedora / RHEL | Notes |
|---|---|---|---|
| **Git install path** | `which git` → `/usr/bin/git` (from `git` package) | same pattern via `dnf install git` | App resolves `git` from PATH only; no bundled git binary. |
| **Git version** | `git --version` ≥ 2.30 | same | Matches CI runners (`ubuntu-latest` ships git 2.x). |
| **Credential helper** | `git config --global credential.helper` often `cache` or unset; libsecret helper available after `git-credential-libsecret` package | `store` or `cache` common | Push/pull auth uses OS helper until in-app askpass lands (see **Known Linux gaps**). |
| **File mode tracking** | `git config core.filemode` defaults to `true` | same | Executable-bit-only changes may appear as modified on Linux; verify VC Changes list matches `git status --porcelain`. |
| **Locale / UTF-8** | `locale` shows `UTF-8` | same | Required for paths with non-ASCII characters in workspace folders. |
| **Temp dir** | `$TMPDIR` or `/tmp` writable | same | Commit message temp files use `std::env::temp_dir()`. |

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
- [ ] **History scope:** History panel toolbar offers **Branch**, **All branches**, and **All + remotes** scope modes; switching modes reloads the commit list and graph together with a loading state.
- [ ] **Scope persistence:** selected history scope persists after closing and reopening the Version Control tab for the same repository.
- [ ] **Scope selection fallback:** with a commit selected, switch to a scope that excludes it — detail pane selects the first visible commit instead of staying on a missing SHA.
- [ ] **Commit detail:** select a commit — metadata and changed-files list appear; selecting a file shows an inline unified diff in the right pane.
- [ ] **Binary / large diff:** select a commit that changes a binary file (or a very large text diff) — diff pane shows a clear placeholder instead of garbled text or UI freeze.
- [ ] **Refresh:** toolbar **Refresh** reloads history without errors.

## Branches

- [ ] **Branch list:** local branches shown; current branch marked.
- [ ] **Checkout:** switch to another branch when working tree is clean — history/branches/header update.
- [ ] **Dirty tree prompt:** modify a tracked file (do not commit) — checkout opens **Local changes detected** dialog with Cancel, Keep changes, and Stash and continue.
- [ ] **Stash and continue:** choose **Stash and continue** on a dirty tree — checkout succeeds; changes restored on the new branch (or conflict toast if apply fails).
- [ ] **Dirty tree cancel:** choose **Cancel** — no checkout; working tree unchanged.
- [ ] **Dirty tree block:** choose **Keep changes** — block message shown; branch does not change.
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
- [ ] **Non-ASCII paths:** create or modify a file whose name contains non-ASCII characters (e.g. `café.txt`, `nested/文件.txt`) — file appears in Changes list with correct path; stage/commit succeeds.
- [ ] **Working-tree diff:** select an unstaged file — inline diff appears with **Unstaged changes** subtitle; select a staged file — **Staged changes** subtitle.
- [ ] **Partial stage:** modify a file, stage part of it (or stage then edit again) — file appears in both lists; selecting from unstaged vs staged shows different diffs and subtitles.
- [ ] **Untracked file:** new untracked file shows all-added diff with **Untracked file** subtitle.
- [ ] **Diff refresh:** with a file diff open, stage/unstage/commit or toolbar **Refresh** — diff pane updates without re-clicking the row; commit on last staged file clears diff when tree is clean.
- [ ] **Autosave before stage/commit:** open a file, edit without saving — **Stage selected**, **Stage all**, **Unstage selected**, or **Commit** saves dirty buffers silently, then proceeds when save succeeds.
- [ ] **Autosave cancel on stage/commit:** simulate a save failure — **Cancel** on the autosave dialog never runs the stage/unstage/commit git command.

## Remote operations

- [ ] **Upstream display:** when tracking branch exists, ahead/behind counts shown in header.
- [ ] **Remote picker:** when remotes exist, toolbar shows a **Remote** dropdown (hidden for bare repos); selection persists after closing and reopening the Version Control tab for the same repository.
- [ ] **Remote fallback:** remove the selected remote with `git remote remove` — picker falls back to `origin` or the first remaining remote without errors.
- [ ] **No remotes:** repository with no remotes shows **No remotes** hint; Fetch/Pull/Push disabled with explanatory tooltips.
- [ ] **Fetch:** **Fetch** uses the selected remote (verify with `git fetch <remote>` in console log when only one remote should update).
- [ ] **Pull:** **Pull** on clean tree uses selected remote and succeeds or shows merge/auth error in toast + console.
- [ ] **Push:** **Push** uses selected remote; succeeds when upstream configured or shows no-upstream / auth message.
- [ ] **Selection stability:** changing the remote dropdown does not reload history/changes panels (no unnecessary refresh).
- [ ] **Parallel guard:** double-click **Push** (or Fetch/Pull) — only one operation runs; buttons re-enable after completion or error.

## Linux smoke run (VC core flows)

Quick pass on Linux after automated CI is green. Covers busy-state guards and remote operations that differ from macOS/Windows credential wiring.

- [ ] **Busy toolbar:** start **Fetch** — Fetch/Pull/Push/Refresh disabled until completion; second click does not start a parallel remote op.
- [ ] **Fetch / Pull / Push:** with a configured remote (HTTPS or SSH), each action uses the selected remote; errors surface in toast + console (auth failures may invoke system credential helper — no in-app askpass yet).
- [ ] **Credential prompt:** HTTPS push/pull to a private remote triggers OS credential helper or clear auth error (not a hung terminal prompt).
- [ ] **Spaces + UTF-8 repo path:** open a workspace whose path contains spaces and/or non-ASCII segments — VC resolves repo root, lists changes, and commits without shell quoting errors.

## Guards (unsaved editor + read-only)

- [ ] **Autosave before git ops:** open a file, edit without saving — **Pull**, **Checkout**, or Changes **Stage** / **Commit** saves dirty buffers silently, then proceeds when save succeeds.
- [ ] **Autosave partial failure:** simulate a save failure (e.g. read-only file on disk) — dialog lists failed files with **Cancel** (default) and **Continue anyway**; **Cancel** never runs the git command.
- [ ] **Autosave continue anyway:** choose **Continue anyway** after partial failure — git operation proceeds despite remaining unsaved buffers.
- [ ] **Unsaved fallback:** when autosave is unavailable, checkout / pull / create branch / stage / commit still blocked with “N unsaved files” dialog (Cancel only).
- [ ] **Bare repository:** open a bare repo — read-only banner; stage/commit/pull disabled.
- [ ] **Detached HEAD:** checkout a tag or commit — detached banner visible; read-only history still works; checkout branch allowed when clean.

## Workspace Manager git column

- [ ] **Git column visible:** Workspace Manager table shows a **Git** column for each workspace row.
- [ ] **Git-backed workspace:** row shows branch name (or detached label), ahead/behind when upstream exists, and dirty/clean marker.
- [ ] **Non-git workspace:** row shows neutral **—** placeholder without errors.
- [ ] **Refresh git:** **Refresh git** toolbar button reloads the column without switching to Version Control tab.
- [ ] **Probe failure:** simulate git probe failure — cell shows **—** and table remains usable.

## Errors and logging

- [ ] **Auth / network failure:** push or pull to unreachable remote — toast with human-readable message; stderr in app console.
- [ ] **No silent failures:** failed git command always surfaces in UI or console.

## OpenCode isolation

- [ ] Disable OpenCode in app settings (or run without sidecar).
- [ ] Version Control tab still probes repo, shows history, and runs stage/commit/checkout.
- [ ] Project tree **M/A/D** badges (OpenCode `file.status`) may still appear — that is expected and separate from VC.

## Known Linux gaps

Documented residual issues after automated parity work (D-11). Severity: **blocker** prevents Linux launch sign-off; **medium** needs follow-up before co-equal launch; **low** acceptable with documented workaround.

| ID | Severity | Issue | Workaround / notes |
|---|---|---|---|
| L-01 | medium | No Linux desktop build in release workflow (`.github/workflows/release.yml` is macOS + Windows only) | Run from source on Linux; add Linux matrix when packaging is ready. |
| L-02 | medium | Custom in-app `GIT_ASKPASS` not implemented ([D-05](../execution/d-05-01-askpass-command-and-credential-request-flow.md)) | Rely on system credential helper (`libsecret`, `cache`, or SSH agent). |
| L-03 | low | Git install hint copy is generic on Linux (no distro-specific package command) | Install `git` via distro package manager; link points to git-scm.com downloads. |
| L-04 | low | `core.filemode` may surface executable-bit-only changes as dirty | Expected git behavior; confirm with `git status --porcelain` before filing bugs. |

**Platform-specific test skips:** none. Integration suites use `describeIfGitInstalled` and skip only when `git` is absent from PATH (not Linux-specific).

## Sign-off

| Platform | Tester | Date | Pass |
|---|---|---|---|
| macOS | | | [ ] |
| Windows | | | [ ] |
| Linux | | | [ ] |

When all platform rows pass, record launch sign-off in `specs/changelog.md`.
