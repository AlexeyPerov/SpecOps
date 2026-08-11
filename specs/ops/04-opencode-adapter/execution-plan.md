# 04 — Execution plan index

**Date:** 2026-08-11  
**Status:** Planned  
**Milestone scope:** [`README.md`](README.md)  
**Roadmap:** [`../roadmap.md`](../roadmap.md)

**Requirements evidence:** Read [`README.md`](README.md), completed historical
plans in [`../../archive/ops-done/phase-3`](../../archive/ops-done/phase-3) and
[`../../archive/ops-done/phase-3.5`](../../archive/ops-done/phase-3.5), plus the
final adapter/extension contracts from phases 01–03.

## 1. Milestone overview

```text
04 — OpenCode adapter migration
  Phase A  Agent Host ownership and runtime lifecycle
  Phase B  Core session/event/interaction parity
  Phase C  Optional extensions, stores and settings UI
  Phase D  Legacy cutover, fixture comparison and exit
```

| Phase | Plan doc | Effort | Ship independently? |
| ----- | -------- | ------ | ------------------- |
| **A** | [`execution-plan-phase-a-host-lifecycle.md`](execution-plan-phase-a-host-lifecycle.md) | L | No |
| **B** | [`execution-plan-phase-b-core-parity.md`](execution-plan-phase-b-core-parity.md) | L | No |
| **C** | [`execution-plan-phase-c-extensions-ui.md`](execution-plan-phase-c-extensions-ui.md) | L | Partial |
| **D** | [`execution-plan-phase-d-cutover-exit.md`](execution-plan-phase-d-cutover-exit.md) | L | Yes, broad beta gate |

**Dependency graph:** `A → B → C → D`. The legacy path stays available until D
but may not own the same child process concurrently with Agent Host.

**Delivery policy:** Preserve behavior through evidence; do not migrate old
session persistence or expand scope with unrelated features.

## 2. Task ID convention

Use `AS04-A-*` through `AS04-D-*`. Mark task headings `[DONE]` when complete.

## 3. Implementation slicing

Each phase is one agent handoff. Phase C must maintain a written parity/deferred
table so Phase D has a finite cutover gate.

## 4. Exit verification

| Check | Required result |
| ----- | --------------- |
| Ownership | Tauri owns Agent Host; Agent Host owns all runtime children |
| Core parity | Sessions, events, permissions/questions and cancellation match fixtures |
| Extensions | Existing supported feature set retained or explicitly deferred |
| Frontend | No direct SDK import or client remains |
| Packaging | Supported-platform smoke green |

## 5. Phase plans

- [Phase A](execution-plan-phase-a-host-lifecycle.md)
- [Phase B](execution-plan-phase-b-core-parity.md)
- [Phase C](execution-plan-phase-c-extensions-ui.md)
- [Phase D](execution-plan-phase-d-cutover-exit.md)
