# 06 — Phase B: early shared-workspace activity

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS03-B accepted activity/write-capability descriptors; AS01-S stream settlement. No handoff/Claude/OpenCode/Cursor dependency.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Make concurrent native work understandable before the first usable Codex preview.

## Implementation boundary

Own early activity/writer warnings, workspace refresh and Stop/recovery explanations. Work remains in shared cwd without execution locks.

## Tasks

### AS06-B-01 — Aggregate activity by session and profile

Use common turn/session status and actual settings/capabilities to show runtime, connection profile, model/settings, current action and Stop. Handle child/host crash, stale generation and pending interaction state.

**Acceptance:** Multiple Codex threads are visible before a second vendor exists; stale activity settles and one profile failure does not hide another.

### AS06-B-02 — Warn before another writer starts

Show active writers and allow Continue, with optional suppression/reset preference. Derive write capability from actual sandbox/policy settings, representing unknown capability honestly.

**Acceptance:** Continue always remains available. Warning never silently cancels, pauses, serializes, locks or changes cwd/profile; concurrent sessions remain allowed.

### AS06-B-03 — Refresh external workspace evidence

Combine native changed-file hints and filesystem watcher updates to refresh tree, editor external-change state and version-control/diff views without overwriting dirty buffers.

**Acceptance:** A session edit or external editor edit becomes visible without workspace reload or losing local unsaved text.

### AS06-B-04 — Show best-effort overlaps and stop semantics

Report changed-path overlap only as non-blocking evidence; explain missing path data and that Stop does not roll back files. Preserve user-owned git/manual recovery; no branches/stashes/merges/worktrees.

**Acceptance:** Overlap hints do not alter execution. Users can identify running writers and understand file effects after cancel/crash without an implication of rollback or isolation.

### AS06-B-05 — Accept the early concurrency gate

Cover multiple same-runtime threads, external edits, writer preference/accessibility, crash settlement and workspace switching. Later repeat with multiple profiles/vendors when enabled.

**Acceptance:** First Codex preview has actual concurrent-writer and refresh evidence; no waiting for handoff schema or all adapters.

## Verification

- Run activity/write-setting, warning/preference, watcher/dirty-buffer, overlap and UI tests.
- Opt-in two Codex threads writing and an external file change; confirm Continue/Stop behavior.

## Exit and next work

B is an independent early gate for 03-D and every applicable 06-D release. Extend its existing tests as profiles/adapters ship; handoff A is not a prerequisite. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
