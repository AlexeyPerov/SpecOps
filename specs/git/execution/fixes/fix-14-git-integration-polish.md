# FIX-14 — Git integration polish

**Priority:** P3 · **Score:** 3 · **Agent:** low · **Estimate:** ~0.75d (split optional)

**Source:** Git integration code review (2026-07-04)  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

Low-priority gaps that are unlikely to cause data loss but affect edge-case correctness, maintainability, or power-user expectations:

| Item | Location |
|---|---|
| `parseBranchVvLine` uses `\S+` — misses unusual branch names | `gitParse.ts` |
| History capped at 500 commits, no pagination | `gitService.ts`, `GitHistoryPanel.svelte` |
| Unstaged diff uses `git diff HEAD` not index-based model | `gitService.ts` (documented) |
| Duplicate `commandId` register error path calls `unregister` | `git.rs` |
| `run_git` env passthrough has no blocklist | `git.rs`, `gitService.ts` |
| `normalize_repo_root` skips canonicalize when path missing | `git.rs` |

## Goal

Address polish items incrementally in one or more small PRs; each sub-item can be marked done independently.

## Implementation steps

### 14a — Branch name parsing

1. Relax `parseBranchVvLine` regex or use structured `git for-each-ref` for branch list queries.
2. Add fixture for branch name edge cases created outside app validation.

### 14b — History pagination

1. Add “Load more” to `GitHistoryPanel` passing increased `limit` to `queryCommits`.
2. Preserve selection and scroll position on append.
3. Cap max limit or virtualize if performance degrades.

### 14c — Diff model documentation

1. Add user-visible subtitle or help tooltip on unstaged diff explaining “vs last commit” semantics.
2. Optional future: toggle for index-based unstaged diff (`git diff` without HEAD).

### 14d — Rust cancellation register cleanup `[DONE]`

1. On `register_active_git_command` failure after spawn, kill orphaned child before return.
2. Do not call `unregister_active_git_command` for unrelated in-flight id on duplicate-id failure.

### 14e — Env blocklist `[DONE]`

1. Block or strip dangerous env keys in Rust (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, etc.) unless explicitly allowlisted for tests.
2. Document allowed env in `git.rs` module comment.

### 14f — Repo root validation `[DONE]`

1. When `repo_root` path does not exist, fail fast with clear error instead of passing through to git.

## Acceptance checklist

- [ ] Each sub-item (14a–14f) has tests or documented manual verification when implemented.
- [ ] Sub-items can ship independently; mark `[DONE]` sub-bullets in this file when complete.
- [ ] No breaking changes to public `gitService` API without changelog note.

## Dependencies

- None

## Changelog

When done (per sub-item or whole): add entry to top of `specs/changelog.md`; mark title or sub-sections with `[DONE]`.
