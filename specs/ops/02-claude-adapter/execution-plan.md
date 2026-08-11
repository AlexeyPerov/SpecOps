# 02 — Execution plan index

**Date:** 2026-08-11  
**Status:** Planned  
**Milestone scope:** [`README.md`](README.md)  
**Roadmap:** [`../roadmap.md`](../roadmap.md)

**Requirements evidence:** Read [`README.md`](README.md), the final phase-01
adapter/protocol contracts, and the pinned SDK documentation/types before
implementation. SDK behavior wins over assumptions in this plan; capability
descriptors must remain honest.

## 1. Milestone overview

```text
02 — Claude adapter
  Phase A  SDK bootstrap, authentication and runtime descriptor
  Phase B  Native sessions, resume and normalized event stream
  Phase C  Permissions, questions and optional capabilities
  Phase D  Recovery, security, contract tests and exit
```

| Phase | Plan doc | Effort | Ship independently? |
| ----- | -------- | ------ | ------------------- |
| **A** | [`execution-plan-phase-a-sdk-auth.md`](execution-plan-phase-a-sdk-auth.md) | M | No |
| **B** | [`execution-plan-phase-b-session-events.md`](execution-plan-phase-b-session-events.md) | L | Developer preview |
| **C** | [`execution-plan-phase-c-capabilities.md`](execution-plan-phase-c-capabilities.md) | M/L | Developer preview |
| **D** | [`execution-plan-phase-d-hardening-exit.md`](execution-plan-phase-d-hardening-exit.md) | M | Yes |

**Dependency graph:** `A → B → C → D`.

**Delivery policy:** No legacy-state migration. Real credentials are used only
in manually gated smoke tests.

## 2. Task ID convention

Use `AS02-A-*` through `AS02-D-*`. Mark task headings `[DONE]` when complete.

## 3. Implementation slicing

Each phase plan is one agent-sized handoff. Phase B is the vertical lifecycle
slice; Phase C may not broaden the mandatory adapter core for optional features.

## 4. Exit verification

| Check | Required result |
| ----- | --------------- |
| Lifecycle | Two sessions create, stream, cancel, restart and resume independently |
| Interaction | Tools, permissions/questions and errors render through common UI |
| Security | Secret canaries absent from state, logs, transcripts and exports |
| Contract | Shared adapter suite green |
| Smoke | Manually gated real-key smoke green |

## 5. Phase plans

- [Phase A](execution-plan-phase-a-sdk-auth.md)
- [Phase B](execution-plan-phase-b-session-events.md)
- [Phase C](execution-plan-phase-c-capabilities.md)
- [Phase D](execution-plan-phase-d-hardening-exit.md)
