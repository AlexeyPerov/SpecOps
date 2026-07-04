# FIX-13 — [DONE] Windows git PATH fallback

**Priority:** P2 · **Score:** 4 · **Agent:** low · **Estimate:** ~0.25d

**Source:** Git integration code review (2026-07-04)  
**Branch policy:** Commit and push directly to `master` unless the user explicitly requests otherwise.

## Problem

`probe_git_available` and all git spawns use `Command::new("git")` relying on PATH only. Git for Windows often installs to `C:\Program Files\Git\cmd\git.exe` without PATH configured in GUI app context.

## Goal

Resolve git executable on Windows using common install locations when PATH lookup fails.

## Required context

1. `app/src-tauri/src/git.rs` — `GIT_BINARY`, `probe_git_available`, `build_git_command`
2. `app/src/lib/git/gitInstallHints.ts` — Windows install URL copy
3. CI runs on `windows-latest` — verify probe test still passes

## Implementation steps

1. Add `resolve_git_binary() -> PathBuf` in `git.rs`:
   - Try `git` on PATH first (current behavior).
   - On Windows NotFound, try ordered list:
     - `%ProgramFiles%\Git\cmd\git.exe`
     - `%ProgramFiles(x86)%\Git\cmd\git.exe`
     - `%LocalAppData%\Programs\Git\cmd\git.exe` (optional)
2. Use resolved path in `build_git_command` and `probe_git_available`.
3. Include resolved path in `GitAvailableResponse` metadata optional field or diagnostic log only (avoid breaking TS type — use existing fields or extend with optional `resolvedPath`).
4. Rust unit test: mock or cfg-gated test documenting fallback order.
5. Update `gitInstallHints` if message should mention PATH vs bundled discovery.

## Acceptance checklist

- [x] When git is installed in default Git for Windows location but not on PATH, probe returns `available: true`.
- [x] When git is truly absent, probe still returns `available: false` with helpful error.
- [x] Non-Windows platforms unchanged.
- [x] All existing `git.rs` tests pass on Linux CI.

## Dependencies

- None

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
