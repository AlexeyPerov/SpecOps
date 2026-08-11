# 03 — Execution plan index

**Date:** 2026-08-11  
**Status:** Planned  
**Milestone scope:** [`README.md`](README.md)  
**Roadmap:** [`../roadmap.md`](../roadmap.md)

**Requirements evidence:** Read [`README.md`](README.md), phase-01 protocol
contracts, lessons recorded during phase 02, and schemas generated from the
pinned app-server version.

## 1. Milestone overview

```text
03 — Codex adapter
  Phase A  Process/protocol bootstrap and authentication
  Phase B  Thread/turn lifecycle and streamed events
  Phase C  Modes, account state and native-history reconciliation
  Phase D  Drift handling, security, contract tests and exit
```

| Phase | Plan doc | Effort | Ship independently? |
| ----- | -------- | ------ | ------------------- |
| **A** | [`execution-plan-phase-a-protocol-auth.md`](execution-plan-phase-a-protocol-auth.md) | L | No |
| **B** | [`execution-plan-phase-b-thread-events.md`](execution-plan-phase-b-thread-events.md) | L | Developer preview |
| **C** | [`execution-plan-phase-c-capabilities-history.md`](execution-plan-phase-c-capabilities-history.md) | M/L | Developer preview |
| **D** | [`execution-plan-phase-d-hardening-exit.md`](execution-plan-phase-d-hardening-exit.md) | M | Yes |

**Dependency graph:** `A → B → C → D`.

**Delivery policy:** Fail closed on unsupported protocol versions. Real auth
flows remain manually gated.

## 2. Task ID convention

Use `AS03-A-*` through `AS03-D-*`. Mark task headings `[DONE]` when complete.

## 3. Implementation slicing

Each phase plan is one agent handoff. Changes to common contracts require
evidence that phase 02 cannot express the needed behavior via capabilities.

## 4. Exit verification

| Check | Required result |
| ----- | --------------- |
| Coexistence | Claude and Codex sessions remain independently usable |
| Auth | API-key and official ChatGPT login complete without secret persistence |
| Lifecycle | Threads/turns stream, cancel and resume correctly |
| Drift | Mismatched protocol version fails before partial parsing |
| Contract/smoke | Shared suite and gated credential smokes green |

## 5. Phase plans

- [Phase A](execution-plan-phase-a-protocol-auth.md)
- [Phase B](execution-plan-phase-b-thread-events.md)
- [Phase C](execution-plan-phase-c-capabilities-history.md)
- [Phase D](execution-plan-phase-d-hardening-exit.md)
