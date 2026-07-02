# Git — Backlog (post-MVP)

Last updated: 2026-07-02  
MVP spec: [version-control-idea.md](./version-control-idea.md)  
Reference: [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

Parking lot for features **explicitly deferred** from MVP decisions and for SourceGit capabilities not shipped in the first release. Items here are **unordered** unless a priority tag is added later.

---

## 1) Explicitly deferred from MVP decisions

These were considered during planning and rejected for v1:

| ID | Feature | Reason deferred | MVP decision ref |
|---|---|---|---|
| D-01 | Commit graph / lane layout | High UI complexity | Idea §3 #5 (flat list) |
| D-02 | Inline diff on commit select | Needs diff viewer infrastructure | Idea §3 #14 |
| D-03 | Full working-copy diff viewer | Same | Idea §3 #14 |
| D-04 | Remote tag delete / push tags | Network + UX scope | Idea §3 #13 |
| D-05 | Custom in-app GIT_ASKPASS | OS credential helper sufficient for MVP | Idea §3 #10 |
| D-06 | Remote picker for push/pull | Default upstream enough for MVP | Idea §3 #9 |
| D-07 | Stash → checkout flow | Block dirty checkout instead | Idea §3 #11 |
| D-08 | Auto-save dirty docs before git ops | Warn/block only | Idea §3 #12 |
| D-09 | Workspace Manager git column | VC tab must land first | Idea §3 #16 |
| D-10 | History across all branches/remotes | Current branch only in MVP | Idea §3 #5 |
| D-11 | Linux as co-equal launch platform | macOS + Windows first | Idea §3 #15 |
| D-12 | Cancel in-flight git subprocess | MVP disables toolbar during ops; no kill/cancel UI | Phase 4 Task 4.5 |

---

## 2) SpecOps follow-ups (not in SourceGit)

| ID | Feature | Notes |
|---|---|---|
| S-01 | **Replace project-tree M/A/D badges with system git** | Today badges use OpenCode `file.status` (`ProjectTreeNode.svelte`, `fileStatusTracker.ts`). Independent of VC tab; optional unification on `git status` + refresh hooks after VC mutations |
| S-02 | Workspace Manager **branch name** column | After VC MVP stable |
| S-03 | Workspace Manager **dirty/clean** indicator | After S-02 |
| S-04 | VC entry from Workspace Manager row actions | Mirror ⚙ Settings pattern |
| S-05 | Keyboard shortcut for Version Control tab | — |
| S-06 | Persist VC panel layout / last section | — |
| S-07 | Link commit file → open in editor at revision | Read-only blob checkout or `git show` buffer |

---

## 3) History & visualization (SourceGit)

Reference: `Views/Histories.axaml`, `Views/Chart.cs`, `Commands/QueryCommits.cs`, `FilterModeInGraph.axaml`

| Feature | SourceGit artifacts |
|---|---|
| Commit graph column with lanes / merge lines | `Histories.axaml`, `Chart.cs` |
| Graph filter modes (current branch / all branches / remotes) | `FilterModeInGraph.axaml` |
| Commit search (author, message, path, content) | `QueryCommits.cs` (search ctor), Repository search toggle |
| Bisect state indicators on commits | `BisectStateIndicator.cs`, `Commands/Bisect.cs` |
| Ahead/behind on graph head | `CommitStatusIndicator.cs` |
| Compact branch names in graph | Preferences |
| Goto revision selector | `GotoRevisionSelector.axaml` |
| Commit relation tracking | `CommitRelationTracking.axaml` |
| Pickable commits / cherry-pick from history | `QueryPickableCommits.cs` |
| File history (per-file log) | `FileHistories.axaml`, `Commands/QueryFileHistory.cs` |
| Directory history | `DirHistories.axaml` |
| Blame | `Blame.axaml`, `Commands/Blame.cs`, `BlameCommandPalette.axaml` |
| Revision compare (two SHAs) | `RevisionCompare.axaml`, `Commands/CompareRevisions.cs` |
| Revision compare standalone window | `RevisionCompareStandalone.axaml` |
| Submodule revision compare | `SubmoduleRevisionCompare.axaml` |
| Statistics (insertions/deletions over range) | `Statistics.axaml`, `Commands/Statistics.cs` |
| Issue tracker links in commit subjects | `IssueTracker.cs`, `CommitSubjectPresenter` |
| AI assistant on diffs | `AIAssistant.axaml`, `GetFileChangeForAI.cs` |

---

## 4) Working copy — advanced (SourceGit)

Reference: `Views/WorkingCopy.axaml`, `Commands/QueryLocalChanges.cs`, `Commands/Discard.cs`

| Feature | SourceGit artifacts |
|---|---|
| Partial / hunk staging | WorkingCopy staging UI |
| Discard changes (file or hunk) | `Discard.axaml`, `Commands/Discard.cs` |
| Assume-unchanged / skip-worktree manager | `AssumeUnchangedManager.axaml`, `Commands/AssumeUnchanged.cs` |
| Include/exclude untracked toggle | WorkingCopy toolbar |
| External merge tool for conflicts | WorkingCopy conflict buttons, `MergeTool.cs` |
| External diff tool | `DiffTool.cs` |
| Inline / side-by-side diff views | `DiffView.axaml`, `TextDiffView.axaml`, `ImageDiffView.axaml` |
| Merge conflict editor | `MergeConflictEditor.axaml`, `Conflict.axaml` |
| Save changes as patch | `Commands/SaveChangesAsPatch.cs` |
| Apply patch | `Apply.axaml`, `Commands/Apply.cs` |
| Format patch | `Commands/FormatPatch.cs` |
| Conventional commit message builder | `ConventionalCommitMessageBuilder.axaml` |
| Commit amend / sign-off / no-verify | `Commit.cs`, `CommitMessageEditor.axaml` |
| Empty commit confirmation | `ConfirmEmptyCommit.axaml` |
| Add to `.gitignore` from file | `AddToIgnore.axaml` |
| File mode change display | `FileModeChange.cs` |
| LFS filtered file indicators | `IsLFSFiltered.cs`, LFS views |

---

## 5) Stash (SourceGit)

Reference: `Views/StashesPage.axaml`, `Commands/Stash.cs`, `Commands/QueryStashes.cs`

| Feature | SourceGit artifacts |
|---|---|
| Stash changes | `StashChanges.axaml` |
| Stash list page | `StashesPage.axaml` |
| Apply stash | `ApplyStash.axaml` |
| Drop stash | `DropStash.axaml` |
| Clear all stashes | `ClearStashes.axaml` |
| Checkout branch from stash | `CheckoutBranchFromStash.axaml` |
| Deal-with-local-changes method dialog | `DealWithLocalChangesMethod.axaml` |

---

## 6) Branches & merges (SourceGit)

Reference: `Views/CreateBranch.axaml`, `Commands/Branch.cs`, `Commands/Merge.cs`, `Commands/Rebase.cs`

| Feature | SourceGit artifacts |
|---|---|
| Branch tree visualization | `BranchTree.axaml` |
| Rename branch | `RenameBranch.axaml` |
| Delete branch (local/remote) | `DeleteBranch.axaml`, `DeleteMultipleBranches.axaml` |
| Edit branch description | `EditBranchDescription.axaml` |
| Merge | `Merge.axaml`, `MergeCommandPalette.axaml`, `MergeMultiple.axaml` |
| Rebase | `Rebase.axaml` |
| Interactive rebase | `InteractiveRebase.axaml`, `QueryCommitsForInteractiveRebase.cs` |
| Cherry-pick | `CherryPick.axaml`, `Commands/CherryPick.cs` |
| Revert commit | `Revert.axaml`, `Commands/Revert.cs` |
| Reset (soft/mixed/hard) | `Reset.axaml`, `Commands/Reset.cs` |
| Reset without checkout | `ResetWithoutCheckout.cs` |
| Checkout detached HEAD UI | `CheckoutDetached.axaml` |
| Checkout + fast-forward | `CheckoutAndFastForward.axaml` |
| Checkout command palette | `CheckoutCommandPalette.axaml` |
| Push to new branch | `PushToNewBranch.axaml` |
| Set upstream | `SetUpstream.axaml` |
| Git Flow start/finish/init | `GitFlowStart.axaml`, `GitFlowFinish.axaml`, `InitGitFlow.axaml`, `Commands/GitFlow.cs` |

---

## 7) Tags — advanced (SourceGit)

Reference: `Views/TagsView.axaml`, `Views/CreateTag.axaml`, `Commands/Tag.cs`

| Feature | SourceGit artifacts |
|---|---|
| Annotated vs lightweight tags | `CreateTag.axaml` |
| Push tag to remote | `PushTag.axaml` |
| Delete multiple tags | `DeleteMultipleTags.axaml` |
| Delete remote tag | `DeleteTag.axaml` (remote variant) |

---

## 8) Remotes & network (SourceGit)

Reference: `Commands/Remote.cs`, `Commands/Fetch.cs`, `Commands/Push.cs`, `Commands/Pull.cs`

| Feature | SourceGit artifacts |
|---|---|
| Add / edit / delete remote | `AddRemote.axaml`, `EditRemote.axaml`, `DeleteRemote.axaml` |
| Remote protocol switcher (HTTPS/SSH) | `RemoteProtocolSwitcher.axaml` |
| Fetch into (merge/rebase target) | `FetchInto.axaml`, `Commands/FetchInto.cs` |
| Push specific revision | `PushRevision.axaml` |
| Prune remote-tracking branches | `PruneRemote.axaml` |
| Custom SSH key per repo | `Command.cs` `GIT_SSH_COMMAND` |
| Custom askpass window | `Askpass.axaml` |
| Command log / replay | `ViewLogs.axaml`, `CommandLogContentPresenter.cs` |
| Popup running status for long ops | `PopupRunningStatus.axaml` |

---

## 9) Submodules (SourceGit)

Reference: `Views/SubmodulesView.axaml`, `Commands/Submodule.cs`

| Feature | SourceGit artifacts |
|---|---|
| Submodule list view | `SubmodulesView.axaml` |
| Add / delete / move submodule | `AddSubmodule.axaml`, `DeleteSubmodule.axaml`, `MoveSubmodule.axaml` |
| Update submodules | `UpdateSubmodules.axaml` |
| Change submodule URL / branch | `ChangeSubmoduleUrl.axaml`, `SetSubmoduleBranch.axaml` |
| Deinit submodule | `DeinitSubmodule.axaml` |
| Query updatable submodules | `QueryUpdatableSubmodules.cs` |

---

## 10) Worktrees (SourceGit)

Reference: `Commands/Worktree.cs`

| Feature | SourceGit artifacts |
|---|---|
| Add worktree | `AddWorktree.axaml` |
| Remove worktree | `RemoveWorktree.axaml` |
| Prune worktrees | `PruneWorktrees.axaml` |

---

## 11) Repository lifecycle (SourceGit)

Reference: `Views/Clone.axaml`, `Views/Init.axaml`, `Commands/Clone.cs`, `Commands/Init.cs`

| Feature | SourceGit artifacts |
|---|---|
| Clone repository | `Clone.axaml`, `Commands/Clone.cs` |
| Open local repository (launcher) | `OpenLocalRepository.axaml` |
| Scan / add repository nodes | `ScanRepositories.axaml`, `EditRepositoryNode.axaml` |
| Repository groups | `CreateGroup.axaml`, `MoveRepositoryNode.axaml` |
| Init with templates / options | `Init.axaml` (beyond MVP minimal init) |
| Archive repo | `Archive.axaml`, `Commands/Archive.cs` |
| Cleanup (gc + prune) | `Cleanup.axaml`, `Commands/Clean.cs`, `Commands/GC.cs` |
| Bare repo full support | `IsBareRepository.cs` |
| Configure workspace / repository | `ConfigureWorkspace.axaml`, `RepositoryConfigure.axaml` |
| Custom actions | `ConfigureCustomActionControls.axaml`, `ExecuteCustomAction.axaml` |

---

## 12) LFS (SourceGit)

Reference: `Commands/LFS.cs`

| Feature | SourceGit artifacts |
|---|---|
| LFS fetch / pull / push | `LFSFetch.axaml`, `LFSPull.axaml`, `LFSPush.axaml` |
| LFS prune | `LFSPrune.axaml` |
| LFS locks | `LFSLocks.axaml` |
| Track custom pattern | `LFSTrackCustomPattern.axaml` |

---

## 13) Launcher & multi-repo (SourceGit)

Reference: `Views/Launcher.axaml`, `ViewModels/Launcher.cs`

| Feature | Notes |
|---|---|
| Repository launcher with tabs | SpecOps uses workspace model instead |
| Welcome / recent repositories | — |
| Self-update | `SelfUpdate.axaml` |
| Hotkeys editor | `Hotkeys.axaml` |
| Global preferences | `Preferences.axaml` |

These are **reference-only** — SpecOps is workspace-scoped, not a multi-repo launcher app.

---

## 14) Platform & infrastructure

| Feature | Notes |
|---|---|
| Linux parity testing & path edge cases | After macOS + Windows MVP |
| libgit2 / isomorphic-git embedded backend | MVP uses system git only |
| Offline commit graph cache | — |
| Signed commits / GPG verify UI | `QueryCommitSignInfo.cs` |
| Credential manager UI | Deferred per D-05 |

---

## 15) Suggested priority (TBD after MVP ship)

| Tier | Items |
|---|---|
| **P1** | S-01 (system git tree badges), commit diff viewer, remote picker, merge conflict surfacing |
| **P2** | Stash, rebase, cherry-pick, file history, S-02 branch column |
| **P3** | Graph column, submodules, LFS, Git Flow, worktrees |
| **P4** | Launcher-style multi-repo features, AI assistant, custom actions |

Re-prioritize after MVP dogfooding.
