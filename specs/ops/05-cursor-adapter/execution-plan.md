# 05 — Execution plan index

**Date:** 2026-08-11  
**Status:** Planned  
**Milestone scope:** [`README.md`](README.md)  
**Roadmap:** [`../roadmap.md`](../roadmap.md)

**Requirements evidence:** Read [`README.md`](README.md), final common contracts,
and the pinned public-beta SDK documentation/types. Treat observed SDK behavior
as authoritative for capabilities.

## 1. Milestone overview

```text
05 — Cursor adapter
  Phase A  SDK bootstrap, auth, health and catalogs
  Phase B  Durable agents/runs and normalized events
  Phase C  Capability gaps and cloud deferral boundary
  Phase D  Recovery, security, contract tests and exit
```

| Phase | Plan doc | Effort | Ship independently? |
| ----- | -------- | ------ | ------------------- |
| **A** | [`execution-plan-phase-a-sdk-auth.md`](execution-plan-phase-a-sdk-auth.md) | M | No |
| **B** | [`execution-plan-phase-b-agent-events.md`](execution-plan-phase-b-agent-events.md) | L | Developer preview |
| **C** | [`execution-plan-phase-c-capabilities-cloud.md`](execution-plan-phase-c-capabilities-cloud.md) | M | Developer preview |
| **D** | [`execution-plan-phase-d-hardening-exit.md`](execution-plan-phase-d-hardening-exit.md) | M | Yes |

**Dependency graph:** `A → B → C → D`.

**Delivery policy:** Pin the beta SDK and isolate its health/version state. Real
credentials are used only in manually gated smoke tests.

## 2. Task ID convention

Use `AS05-A-*` through `AS05-D-*`. Mark task headings `[DONE]` when complete.

## 3. Implementation slicing

Each phase is one agent handoff. Unsupported behaviors stay absent from the
capability manifest; prompt emulation is outside the implementation slice.

## 4. Exit verification

| Check | Required result |
| ----- | --------------- |
| Lifecycle | Local runs create, stream, follow up, cancel and recover as supported |
| Catalogs | Models/modes come from the SDK, not generic provider settings |
| Isolation | Beta/offline state affects only this runtime |
| Product | No standalone Chat or Cloud context appears |
| Contract/smoke | Shared suite and gated real-key smoke green |

## 5. Phase plans

- [Phase A](execution-plan-phase-a-sdk-auth.md)
- [Phase B](execution-plan-phase-b-agent-events.md)
- [Phase C](execution-plan-phase-c-capabilities-cloud.md)
- [Phase D](execution-plan-phase-d-hardening-exit.md)
