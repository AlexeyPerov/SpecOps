# 06 — Execution plan index

**Date:** 2026-08-11  
**Status:** Planned  
**Milestone scope:** [`README.md`](README.md)  
**Roadmap:** [`../roadmap.md`](../roadmap.md)

**Requirements evidence:** Read [`README.md`](README.md), the shared-`cwd` and
handoff sections in [`../roadmap.md`](../roadmap.md), and the shipped capability
descriptors for every enabled runtime.

## 1. Milestone overview

```text
06 — Handoff and release polish
  Phase A  Reviewable cross-runtime handoff and lineage
  Phase B  Shared-workspace activity and conflict observability
  Phase C  Packaging, health, diagnostics and recovery
  Phase D  Platform/security matrix, docs and release exit
```

| Phase | Plan doc | Effort | Ship independently? |
| ----- | -------- | ------ | ------------------- |
| **A** | [`execution-plan-phase-a-handoff.md`](execution-plan-phase-a-handoff.md) | L | Yes |
| **B** | [`execution-plan-phase-b-observability.md`](execution-plan-phase-b-observability.md) | M/L | Yes |
| **C** | [`execution-plan-phase-c-packaging-diagnostics.md`](execution-plan-phase-c-packaging-diagnostics.md) | L | No |
| **D** | [`execution-plan-phase-d-release-exit.md`](execution-plan-phase-d-release-exit.md) | M/L | Yes, release gate |

**Dependency graph:** `A → B`; `A + B → C → D`. A and B may be implemented in
parallel only after their shared session-lineage/activity schema is agreed.

**Delivery policy:** Handoff requires user review. Concurrency controls warn and
observe but never lock, isolate, serialize, commit, or roll back.

## 2. Task ID convention

Use `AS06-A-*` through `AS06-D-*`. Mark task headings `[DONE]` when complete.

## 3. Implementation slicing

Each phase is one agent handoff. Platform-specific fixes discovered in D stay in
D unless they require a contract correction, which must be recorded explicitly.

## 4. Exit verification

| Check | Required result |
| ----- | --------------- |
| Handoff | Every enabled pair creates a new traceable session from reviewed content |
| Concurrency | Second writer warns but remains allowed; overlap signals are best effort |
| Security | Handoff/support bundles exclude secret canaries and raw tool output by default |
| Processes | Launch, crash, restart and shutdown leave no orphans on supported platforms |
| Docs | Auth, capabilities, risks, handoff, diagnostics and recovery are complete |

## 5. Phase plans

- [Phase A](execution-plan-phase-a-handoff.md)
- [Phase B](execution-plan-phase-b-observability.md)
- [Phase C](execution-plan-phase-c-packaging-diagnostics.md)
- [Phase D](execution-plan-phase-d-release-exit.md)
