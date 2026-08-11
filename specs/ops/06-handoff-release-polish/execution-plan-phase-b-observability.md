# 06 — Phase B: shared-workspace activity and conflict observability

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisites:** Stable runtime capability/activity descriptors  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Make concurrent shared-`cwd` work visible without taking control from the user.

## Agent handoff boundary

Own activity aggregation, write-capable warnings, file/diff refresh, overlap
signals, explanatory UX, and preferences. Do not add locking or git automation.

## Tasks

### AS06-B-01 — Aggregate running/write-capable activity

Derive workspace activity from common session/turn status and capability data;
show runtime, model/mode, current action, and Stop affordance.

**Acceptance:** Crashed/stale turns clear predictably and one adapter’s health never hides another’s activity.

### AS06-B-02 — Warn on a second writer

Before starting another write-capable turn, show an allow-and-warn dialog with
active writers and optional “do not show again” preference.

**Acceptance:** Continue always remains available; warning never pauses, serializes, redirects, or cancels work.

### AS06-B-03 — Refresh workspace evidence

Combine adapter file-change hints with filesystem watcher notifications to
refresh project tree, editor state, version-control status, and session diffs.

**Acceptance:** External/other-session writes become visible without requiring a full workspace reload.

### AS06-B-04 — Add best-effort overlap signals

Compare reported changed paths for simultaneous turns and display a non-blocking
warning with session links and recovery guidance.

**Acceptance:** False negatives/positives cannot alter execution; missing path data is represented honestly.

### AS06-B-05 — Explain stop and recovery semantics

State that Stop does not roll back files and recovery uses user-controlled git
or manual edits; add preference/reset and accessibility coverage.

**Acceptance:** No UI copy implies isolation, rollback, serialization, or conflict prevention.

## Verification

- Run activity, warning preference, watcher/diff refresh, overlap and accessibility tests.
- Manually run two writers plus an external editor change.
- Verify continue/stop behavior and version-control refresh.

## Handoff

Phase C starts when concurrency is understandable and observable without any hidden control policy.
