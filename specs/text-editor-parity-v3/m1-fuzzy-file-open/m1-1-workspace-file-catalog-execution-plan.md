# M1.1 — Workspace File Catalog

**Parent:** [Text Editor Parity v3](../README.md)  
**Prerequisite:** [M0.6](../m0-editor-foundations/m0-6-picker-index-foundations-execution-plan.md) complete  
**Next:** [M1.2 quick-open UI](./m1-2-quick-open-ui-execution-plan.md)  
**Status:** Done  
**Complexity:** Heavy — Score 7

How to use this plan: assign to one agent. Deliver a production-ready file catalog and ranking model; do not add the visible picker yet.

## Goal

Provide fast, deterministic workspace-file candidates for quick open without rescanning file contents or coupling to the expanded project tree.

## Required context

1. M0.6 catalog/ranking APIs
2. `folderOpenableFiles.ts`
3. `projectTreeController.ts`
4. `appShellRuntime.ts` file-watcher path
5. `openActivePath.ts` and `openFileGate.ts`
6. Active workspace/context helpers

## Task breakdown

#### Task M1.1-1: Implement per-workspace catalog lifecycle [Score:7] [Agent:heavy] [DONE]

- Enumerate openable files on workspace activation in the background.
- Store absolute path, normalized relative path, basename, directory, and stable key.
- Preserve hidden/heavy directory and symlink policy from M0.4.
- Support explicit refresh and incremental add/remove/rename invalidation from watcher events; fall back to debounced rebuild when an event cannot be classified safely.
- Dispose catalogs when a workspace closes and isolate catalogs by normalized root.

**Acceptance checklist**

- Workspace switches cannot leak candidates from the prior workspace.
- Unreadable directories are skipped and surfaced as a non-fatal partial-catalog status.
- Repeated watcher bursts trigger at most one bounded refresh.
- Enumeration never reads file contents.

Dependencies: M0.6.

---

#### Task M1.1-2: Rank and present file candidates [Score:6] [Agent:medium] [DONE]

- Add a file-specific ranking adapter over shared fuzzy scoring.
- Rank basename matches before equivalent directory-only matches.
- Add stable recency boosts using already-open/recent-file state without changing persisted formats.
- Deduplicate normalized paths and handle case sensitivity according to the host path normalization policy.
- Bound displayed results while retaining total match/loading metadata.

**Acceptance checklist**

- Tests cover duplicate basenames, nested paths, separator-insensitive queries, exact matches, recent files, and empty query.
- Empty query orders open/recent files first, then catalog paths deterministically.
- Ranking 10,000 synthetic entries stays within an agreed unit-test performance budget.

Dependencies: M1.1-1.

---

#### Task M1.1-3: Catalog diagnostics and integration tests [Score:5] [Agent:medium] [DONE]

- Add debug/performance diagnostics for initial build, rebuild, entry count, partial errors, and ranking duration.
- Add integration tests with mocked Tauri directory reads and watcher changes.
- Verify workspace close/switch and generation cancellation.

**Acceptance checklist**

- Diagnostics contain no file contents.
- Tests include stale-generation suppression.
- `npm test` and `npm run check` pass.

Dependencies: M1.1-2.

## Plan exit criteria

- [x] Active workspaces expose a cancellable, cached file catalog.
- [x] File ranking is deterministic, tested, and bounded.
- [x] Watcher-driven refresh is debounced and workspace-safe.
- [x] No visible quick-open UI ships in this plan.

## Changelog instructions

Mark tasks `[DONE]`; add a dated entry including catalog behavior, scale test, and validation.

