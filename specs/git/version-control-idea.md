# Version Control — Idea, Decisions & Requirements

Last updated: 2026-07-02  
Status: approved for planning  
Reference UI: [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)  
Execution (MVP, archived): [phase-0](../archive/git/phase-0-execution-plan.md) → [phase-1](../archive/git/phase-1-execution-plan.md) → [phase-2](../archive/git/phase-2-execution-plan.md) → [phase-3](../archive/git/phase-3-execution-plan.md) → [phase-4](../archive/git/phase-4-execution-plan.md) · Post-MVP: [backlog](./backlog.md) → [execution/](./execution/)  
Backlog: [backlog.md](./backlog.md)

---

## 1) Summary

Add **Version Control** — a per-workspace git feature set backed by **system `git`**, opened as a singleton **view tab** in the workspace editor pane (same pattern as Workspace Settings). Reachable from the **workspace context menu** on the activity rail.

The tab provides an MVP git client: current-branch history, branches (list + switch + create), tags (list + create + local delete), working-copy changes (stage/unstage + commit), fetch, pull, and push. Git operations run through a new **Tauri/Rust** subprocess layer (SourceGit-style shell-out), not through OpenCode.

**Out of scope for MVP:** commit graph, inline diffs, merge/rebase/stash, remote management UI, custom askpass, Workspace Manager git column. See [backlog.md](./backlog.md).

---

## 2) Goals

| Goal | Detail |
|---|---|
| Discoverability | Every workspace exposes **Version Control** in its context menu |
| Familiar UX | History + branches + tags + changes layout inspired by SourceGit / typical git GUIs |
| System git | Use the user's installed `git` binary and credential helpers / SSH agent |
| Isolation | Git module has **zero dependency on OpenCode** (`file.status`, sidecar, etc.) |
| Consistency | Reuse existing view-tab, context-menu, and workspace-scoping patterns |
| Platform | Ship **macOS + Windows** first; Linux follows in backlog |

---

## 3) Decisions (locked)

| # | Topic | Choice |
|---|---|---|
| 1 | Git execution | New **Tauri/Rust** layer wrapping system `git` (SourceGit-style subprocess) |
| 2 | Repository root | Auto-discover via `git rev-parse --show-toplevel` from workspace root; all ops scoped to that root |
| 3 | Tab lifetime | **Singleton per workspace session** — `openOrFocusViewTab("version-control")` (like Workspace Settings) |
| 4 | Non-git workspaces | Always show menu item; tab explains **not a repo** / **git not found**; optional **Init repository** in empty state |
| 5 | Commit history UI | **Flat list** for current branch (SHA, author, date, subject, ref decorations) — no graph in MVP |
| 6 | Working copy | Dedicated **Changes** section: unstaged/staged lists, stage/unstage, commit message box |
| 7 | OpenCode coupling | **None.** VC module is fully independent. Existing project-tree M/A/D badges (OpenCode `file.status`) stay unchanged in MVP; replacement deferred to [backlog](./backlog.md) |
| 8 | Fetch | Include **Fetch**; Pull uses `git pull` (fetch + merge/rebase per git config) |
| 9 | Push/pull target | **Default remote + upstream** (`origin`, tracking branch if set) |
| 10 | Authentication | Rely on system git + OS credential helper / SSH agent; surface stderr in UI |
| 11 | Dirty tree on checkout | **Block** checkout with clear message when git reports dirty working tree |
| 12 | Unsaved editor docs | **Warn/block** checkout, pull, and other destructive git ops when workspace has unsaved open files |
| 13 | Tag delete | **Local tags only** (`git tag -d`) in MVP |
| 14 | Commit detail | Select commit → metadata + **changed files list**; no inline diff in MVP |
| 15 | Platforms | **macOS + Windows** first |
| 16 | Workspace Manager | **No git column** until VC MVP is stable |

### 3.1 Independence from OpenCode

Two git-adjacent surfaces exist today; only one is in scope:

| Surface | Location | Data source | MVP |
|---|---|---|---|
| **Version Control tab** (new) | Editor view tab | System `git` via Tauri | **In scope** |
| **Project tree badges** (existing) | Left sidebar, per-file **M/A/D** pills | OpenCode `file.status` | **Unchanged** — not part of VC module |

The former top-right title-bar OpenCode status popover (removed 2026-07-02) was unrelated to git. Project tree badges are separate (see below).

---

## 4) Entry points & UX

### 4.1 Context menu

Add **Version Control** to the workspace context menu (`AppShell` workspace menu), below or near **Settings**:

1. `switchContext(workspaceId)`
2. `openOrFocusViewTab("version-control")`
3. Close context menu

Same flow may later be linked from Workspace Manager (backlog).

### 4.2 View tab

| Property | Value |
|---|---|
| Tab kind | `"version-control"` |
| Tab strip title | **Version Control** |
| Scope | Active workspace root → resolved git repo root |
| Layout | Chrome-less editor pane; sidebar sections (see §4.3) |

### 4.3 Sections (sidebar)

| Section | MVP content |
|---|---|
| **History** | Flat commit list (current branch); detail pane with metadata + file list |
| **Branches** | Local (+ remote-tracking labels); switch; create branch |
| **Tags** | List; create; delete local |
| **Changes** | Unstaged / staged file lists; stage / unstage; commit message + **Commit** |
| **Toolbar** (shared) | Current branch, ahead/behind, **Fetch**, **Pull**, **Push**, **Refresh** |

### 4.4 Empty / error states

| Condition | UI |
|---|---|
| `git` not on PATH | Explain; link to install docs (platform-specific copy) |
| Workspace not inside a repo | Explain; offer **Init repository** (`git init` at workspace root or discovered root policy — init at workspace root) |
| Bare repository | Read-only message; disable write actions |
| Detached HEAD | Show detached state; allow read; checkout warns normally |
| Command failed | Show git stderr; log to app console |

---

## 5) Architecture

```
Workspace context menu "Version Control"
  → appState.switchContext(ws) + openOrFocusViewTab("version-control")
  → VersionControlView.svelte
       ├── HistoryPanel / BranchesPanel / TagsPanel / ChangesPanel
       └── gitService.ts (typed TS API, no OpenCode imports)
            → invoke("run_git", { repoRoot, args, env? })
                 → app/src-tauri/src/git.rs
                      → spawn `git` with cwd = repoRoot
                      → return { exitCode, stdout, stderr, durationMs }
```

### 5.1 Layer responsibilities

| Layer | Responsibility |
|---|---|
| **Rust (`git.rs`)** | Resolve `git` binary; spawn process; set `cwd`; optional timeout/cancel; capture stdout/stderr; never shell-interpolate user strings into a shell — pass args as argv |
| **TS (`gitService.ts`)** | Repo discovery; typed queries (log, branch, tag, status); porcelain parsing; domain errors |
| **TS (`gitQueries.ts` / `gitCommands.ts`)** | Pure parsers + command builders (testable without Tauri) |
| **UI (`VersionControlView` + panels)** | Loading/error states; guard unsaved docs before mutations; refresh after writes |

### 5.2 Repo root resolution

```
workspaceRootPath
  → git rev-parse --show-toplevel
  → repoRoot (cached per workspace for session)
```

If workspace is a subfolder of a repo, all git ops use `repoRoot`, not `workspaceRootPath`.

### 5.3 Refresh model

After any mutating operation (checkout, commit, push, pull, tag, stage):

1. Re-query affected panels (status, current branch, history, branches, tags).
2. Emit a lightweight workspace event so other UI *may* listen later (tree badges remain OpenCode-driven in MVP).

### 5.4 Unsaved document guard

Before checkout, pull, or other ops that modify working tree / HEAD:

1. Collect dirty documents in the **active workspace context** (existing `DocumentState` helpers).
2. If any dirty: block with dialog listing count; offer cancel (no auto-save in MVP).

---

## 6) MVP git command matrix

Read-only queries (phase 2):

| Operation | Git command (conceptual) |
|---|---|
| Repo root | `git rev-parse --show-toplevel` |
| Git available | `git --version` |
| Current branch | `git branch --show-current` (+ detached detection) |
| Ahead/behind | `git rev-list --left-right --count @{u}...HEAD` (when upstream exists) |
| Commits (current branch) | `git log --format=…` (structured NUL/tab format) |
| Commit files | `git show --name-status --format= <sha>` |
| Branches | `git branch -vv` |
| Tags | `git tag -l` (+ optional `git show` for metadata) |
| Status | `git status --porcelain=v2 -z` or v1 porcelain |

Mutations (phase 3):

| Operation | Git command (conceptual) |
|---|---|
| Checkout | `git checkout <branch>` |
| Create branch | `git branch <name>` or `git checkout -b <name>` |
| Stage | `git add -- <paths>` |
| Unstage | `git restore --staged -- <paths>` |
| Commit | `git commit -F <tempfile>` or `-m` |
| Fetch | `git fetch` |
| Pull | `git pull` |
| Push | `git push` (default remote/upstream) |
| Create tag | `git tag <name>` |
| Delete tag | `git tag -d <name>` |
| Init (empty state) | `git init` |

Exact formats should mirror stable `--format` strings from the reference project (see [`QueryCommits.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryCommits.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryCommits.cs), [`QueryBranches.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryBranches.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryBranches.cs)).

---

## 7) Requirements

### 7.1 Functional (MVP)

- [x] VC menu item on every workspace context menu
- [x] Singleton `version-control` view tab per workspace session
- [x] Detect missing git and non-repo workspaces with actionable empty states
- [x] Init repository from empty state (creates repo at workspace root)
- [x] Display current branch and ahead/behind when upstream exists
- [x] Flat commit history for current branch with selectable detail
- [x] Branch list with checkout and create-branch
- [x] Tag list with create and local delete
- [x] Changes panel: unstaged/staged, stage/unstage, commit with message
- [x] Fetch, pull, push (default remote/upstream)
- [x] Block checkout when git working tree is dirty
- [x] Block selected git ops when workspace has unsaved editor documents
- [x] Surface git stderr on failure; log commands to app console

### 7.2 Non-functional

- [x] No imports from OpenCode modules in `app/src/lib/git/**`
- [x] Git subprocess runs only from Tauri backend (not webview shell)
- [x] Parsers covered by unit tests with fixture output strings
- [x] macOS + Windows tested for path normalization (`\` vs `/` in displayed paths)
- [x] No persisted data migrations required (no VC settings in MVP)

### 7.3 Explicit non-goals (MVP)

See [backlog.md](./backlog.md) for the full deferred list. Highlights:

- Commit graph / lane layout
- Inline or side-by-side diff viewer for commits or working copy
- Merge, rebase, cherry-pick, stash
- Remote CRUD, push to arbitrary remote/branch picker
- Custom GIT_ASKPASS UI
- Replace OpenCode project-tree badges with system git
- Workspace Manager git column
- Linux-first optimizations (Linux support follows after macOS + Windows)

---

## 8) Implementation phases (overview)

| Phase | Focus | Estimate | Plan |
|---|---|---|---|
| **0** | Tauri git runner, repo detection, TS service shell, tests | ~3–5 days | [phase-0-execution-plan.md](../archive/git/phase-0-execution-plan.md) |
| **1** | View tab kind, context menu, VC view shell, empty states | ~2–3 days | [phase-1-execution-plan.md](../archive/git/phase-1-execution-plan.md) |
| **2** | Read-only: history, branches, tags, refresh | ~4–6 days | [phase-2-execution-plan.md](../archive/git/phase-2-execution-plan.md) |
| **3** | Mutations: checkout, changes, commit, fetch/pull/push, tags | ~7–10 days | [phase-3-execution-plan.md](../archive/git/phase-3-execution-plan.md) |
| **4** | Hardening: guards, errors, cross-platform, verification | ~4–6 days | [phase-4-execution-plan.md](../archive/git/phase-4-execution-plan.md) |

**Total MVP:** ~3–4.5 weeks (single developer, agent-assisted).

---

## 9) File inventory (planned)

| Area | New / modified (indicative) |
|---|---|
| Tauri | `app/src-tauri/src/git.rs`, register in `lib.rs`, capabilities |
| TS service | `app/src/lib/git/gitService.ts`, `gitQueries.ts`, `gitCommands.ts`, `types.ts` |
| UI | `app/src/lib/components/VersionControlView.svelte`, panel subcomponents |
| Domain | `ViewTabState.view` + `createViewTab` / `normalizeTabState` / `openOrFocusViewTab` |
| Routing | `EditorPaneContent.svelte`, `TabBar.svelte`, `editorRouting.ts` |
| Menu | `AppShell.svelte`, `workspaceContextMenuController.ts` |
| Tests | `gitQueries.test.ts`, `gitService.test.ts`, Rust git tests, fixture strings |

---

## 10) Reference mapping (reference git UI → SpecOps MVP)

Reference project: [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

| Reference area | SpecOps MVP |
|---|---|
| `Commands/Command.cs` (spawn git) | `git.rs` + `gitService.ts` |
| `Views/Repository.axaml` (layout) | `VersionControlView.svelte` sidebar sections |
| `Views/Histories.axaml` (graph list) | Flat `HistoryPanel` (no graph) |
| `Views/WorkingCopy.axaml` | `ChangesPanel` (simplified) |
| `Views/TagsView.axaml` | `TagsPanel` |
| `Commands/QueryCommits.cs` | `gitQueries.ts` log parser |
| `Views/Askpass.axaml` | Deferred — OS credential helper |

Everything else → [backlog.md](./backlog.md).
