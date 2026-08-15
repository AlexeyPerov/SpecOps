# 01 — Execution plan index

**Date:** 2026-08-11  
**Status:** Done (2026-08-15)  
**Milestone scope:** [`README.md`](README.md)  
**Roadmap:** [`../roadmap.md`](../roadmap.md)

**Requirements evidence:** Read the locked decisions in [`README.md`](README.md),
the architecture and persistence sections in [`../roadmap.md`](../roadmap.md),
and characterize the current Chat/workspace-agent behavior before deleting or
replacing code.

## 1. Milestone overview

```text
01 — Sessions foundation and Agent Host
  Phase A  Remove Chat and dormant Cloud surfaces
  Phase B  Runtime-neutral session domain and persistence
  Phase C  Adapter core, capabilities and deterministic fake runtime
  Phase D  Bundled Agent Host and JSON-RPC protocol
  Phase E  Tauri supervision and process-tree cleanup
  Phase F  Sessions UX integration and foundation exit
```

| Phase | Plan doc | Effort | Ship independently? |
| ----- | -------- | ------ | ------------------- |
| **A** | [`execution-plan-phase-a-chat-removal.md`](execution-plan-phase-a-chat-removal.md) | L | Yes |
| **B** | [`execution-plan-phase-b-session-domain.md`](execution-plan-phase-b-session-domain.md) | L | No |
| **C** | [`execution-plan-phase-c-adapter-contract.md`](execution-plan-phase-c-adapter-contract.md) | M/L | No |
| **D** | [`execution-plan-phase-d-agent-host.md`](execution-plan-phase-d-agent-host.md) | L | No |
| **E** | [`execution-plan-phase-e-supervision.md`](execution-plan-phase-e-supervision.md) | M/L | No |
| **F** | [`execution-plan-phase-f-sessions-ux-exit.md`](execution-plan-phase-f-sessions-ux-exit.md) | L | Yes, foundation preview |

**Dependency graph:** `A → B → C → D → E → F`. Phase A may begin in parallel
with detailed design for B/C, but implementation handoff follows this order.

**Delivery policy:** Pre-launch; change schemas directly. Do not add migrations,
compatibility shims, branches, or PR-only workflow.

## 2. Task ID convention

`AS01-<phase>-<NN>` identifies one focused implementation task. Mark task
headings `[DONE]` without rewriting their descriptions.

## 3. Implementation slicing

Each phase document is intended for one agent handoff. If a phase cannot fit one
working session, the agent must stop at a documented task boundary and update
its status rather than silently expanding scope.

## 4. Exit verification

| Check | Required result |
| ----- | --------------- |
| Product surfaces | Chat/Cloud absent; workspace Sessions remains |
| Domain | New codecs round-trip; no legacy compatibility branches |
| Protocol | Framing, limits, cancellation, timeouts and version negotiation pass |
| Supervision | Crash/restart/shutdown leaves no child processes |
| UI | Fake runtime lifecycle works end to end |
| Regression | Editor, workspace, version-control and non-AI suites green |

## 5. Phase plans

- [Phase A](execution-plan-phase-a-chat-removal.md)
- [Phase B](execution-plan-phase-b-session-domain.md)
- [Phase C](execution-plan-phase-c-adapter-contract.md)
- [Phase D](execution-plan-phase-d-agent-host.md)
- [Phase E](execution-plan-phase-e-supervision.md)
- [Phase F](execution-plan-phase-f-sessions-ux-exit.md)
