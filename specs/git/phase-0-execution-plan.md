# Phase 0 Execution Plan — Git Foundation

**Spec:** [version-control-idea.md](./version-control-idea.md) §8 phase 0  
**Next:** [phase-1-execution-plan.md](./phase-1-execution-plan.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

How to use this plan: each task lists **Required context** — read only those docs for that task. Cross-cutting **Confidence and Risks** below applies to every task.

## Assumptions

- Implementation is agent-only; human role is approval/review.
- System **`git`** on PATH is the only backend (no libgit2, no OpenCode).
- Git subprocess runs **only** from Tauri Rust — not from the Svelte webview.
- Breaking changes to persisted app data are acceptable; no migration shims for VC.
- macOS + Windows are primary test targets for this phase.

## Confidence and Risks

Confidence: **Medium–High** for phase 0 (well-scoped infrastructure).

Resolved constraints:

1. Architecture locked in [version-control-idea.md](./version-control-idea.md) §5.
2. OpenCode must not appear in `app/src/lib/git/**`.

Residual uncertainties:

1. Tauri v2 capability permissions for `Command::new("git")` may need explicit allowlist.
2. Windows `git.exe` discovery (PATH vs common install paths) may need a fallback probe.
3. Large stdout buffers (big `git log`) may need streaming or cap in later phases — acceptable to buffer for MVP if log limits applied in phase 2.

## Agent Level Legend

- `easy`: straightforward implementation, clear requirements.
- `medium`: moderate complexity, some design decisions needed.
- `heavy`: complex logic, strong reasoning and long-context required.

## Changelog Instructions

- When a task is completed, mark it as DONE (append `[DONE]` to its title) in this file.
- Add changes to the top of `specs/changelog.md`.
- Include date/time in each changelog title entry.

## Task Breakdown

#### Task 0.1: Rust git module scaffold (G0-1) [Score:4] [Agent:easy] [~0.5d] [DONE]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §5 architecture
2. `app/src-tauri/src/lib.rs`, `app/src-tauri/Cargo.toml`

- Add `mod git;` and register Tauri command stub `run_git` in `invoke_handler`.
- Define `RunGitRequest` / `RunGitResponse` structs (Serialize/Deserialize): `repo_root`, `args: Vec<String>`, optional `env` map → `exit_code`, `stdout`, `stderr`, `duration_ms`.
- Add capabilities/permissions needed for process spawn (document in command doc comment).

**Acceptance checklist**

- App builds with new module; stub command returns `{ exit_code: 0, stdout: "", stderr: "", duration_ms: 0 }` when args empty (or not yet wired).
- No frontend usage required in this task.

Dependencies: none.

---

#### Task 0.2: Git binary probe (G0-2) [Score:5] [Agent:easy] [~0.5d] [DONE]

**Required context**

1. Task 0.1 output
2. [version-control-idea.md](./version-control-idea.md) — §4.4 empty states

- Implement `git_available()` Tauri command: run `git --version`, return `{ available: bool, version: string | null, error: string | null }`.
- On Windows, rely on PATH first; optional note in code if common paths needed later.

**Acceptance checklist**

- Returns `available: true` and version string when git is installed.
- Returns `available: false` with error when git missing (test with mock or skip in CI).
- Unit test in Rust for response shape parsing.

Dependencies: Task 0.1.

---

#### Task 0.3: `run_git` subprocess executor (G0-3) [Score:8] [Agent:medium] [~1d] [DONE]

**Required context**

1. Task 0.1–0.2
2. Reference subprocess pattern: [`Command.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/Command.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/Command.cs) — `CreateGitStartInfo`, `ExecAsync`

- Implement `run_git`: spawn `git` with `current_dir = repo_root`, pass `args` as argv (no shell).
- Capture stdout/stderr as UTF-8 strings; record exit code and duration.
- Reject empty `repo_root`; normalize path before spawn.
- Do **not** inject `SOURCEGIT_*` env vars; pass through minimal env (inherit or explicit `PATH`).

**Acceptance checklist**

- `run_git({ repo_root, args: ["status"] })` succeeds in a temp git repo (Rust test or manual).
- Args with spaces are safe (single argv element, not shell-split).
- Non-zero exit returns stderr without panicking.

Dependencies: Task 0.2.

---

#### Task 0.4: Repo root resolution (G0-4) [Score:6] [Agent:medium] [~0.5d] [DONE]

**Required context**

1. Task 0.3
2. [version-control-idea.md](./version-control-idea.md) — §5.2

- Add TS module `app/src/lib/git/types.ts` — shared result/error types.
- Add `resolveRepoRoot(workspaceRootPath)` in `gitService.ts` calling `run_git` with `rev-parse --show-toplevel`.
- Map exit code 128 / not-a-repo to typed `GitNotARepositoryError`.

**Acceptance checklist**

- Resolves correct root when workspace is a subdirectory of a repo (fixture test with nested path).
- Returns typed error when path is not in a repo.
- No OpenCode imports in `app/src/lib/git/**`.

Dependencies: Task 0.3.

---

#### Task 0.5: TS gitService invoke wrapper (G0-5) [Score:5] [Agent:easy] [~0.5d]

**Required context**

1. Task 0.4
2. Existing Tauri invoke patterns in `app/src/lib/services/`

- Implement `runGit(repoRoot, args)` thin wrapper around `invoke("run_git")`.
- Implement `checkGitAvailable()` wrapper around `git_available`.
- Export from `app/src/lib/git/gitService.ts` barrel.

**Acceptance checklist**

- Typecheck passes; functions usable from Svelte later.
- Errors from Tauri propagate as typed `GitError` union.

Dependencies: Task 0.4.

---

#### Task 0.6: Parser test fixtures + pure helpers (G0-6) [Score:6] [Agent:medium] [~1d]

**Required context**

1. [version-control-idea.md](./version-control-idea.md) — §6 command matrix
2. Reference log/branch format strings: [`QueryCommits.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryCommits.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryCommits.cs), [`QueryBranches.cs`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Commands/QueryBranches.cs) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Commands/QueryBranches.cs)

- Create `app/src/lib/git/fixtures/` with sample stdout for: `git log --format=…`, `git branch -vv`, `git tag -l`, `git status --porcelain`.
- Add `gitParse.test.ts` skeleton with one passing parse test (e.g. parse single commit line).
- Add `app/src/lib/git/gitParse.ts` placeholder exports for phase 2.

**Acceptance checklist**

- `npm test` includes new test file; at least one fixture parse assertion passes.
- Fixtures documented with which git command produced them.

Dependencies: Task 0.5.

---

## Dependency graph

```text
Task 0.1 → Task 0.2 → Task 0.3 → Task 0.4 → Task 0.5 → Task 0.6
```

## Phase 0 exit criteria

- [ ] `run_git` and `git_available` Tauri commands work on macOS + Windows dev machines.
- [ ] `resolveRepoRoot` returns repo root or typed not-a-repo error.
- [ ] `app/src/lib/git/**` exists with no OpenCode imports.
- [ ] Parser fixture harness ready for phase 2.

**Estimate:** ~3.5–4 days
