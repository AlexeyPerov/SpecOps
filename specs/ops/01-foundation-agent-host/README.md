# 01 — Sessions foundation and Agent Host

**Status:** Planned  
**Date:** 2026-08-11  
**Main doc (SSOT):** [`../roadmap.md`](../roadmap.md)  
**Execution plan:** [`execution-plan.md`](execution-plan.md)  
**Phase plans:** [A](execution-plan-phase-a-chat-removal.md), [B](execution-plan-phase-b-session-domain.md), [C](execution-plan-phase-c-adapter-contract.md), [D](execution-plan-phase-d-agent-host.md), [E](execution-plan-phase-e-supervision.md), [F](execution-plan-phase-f-sessions-ux-exit.md)

This milestone removes the obsolete standalone AI surfaces and establishes the
runtime-neutral domain, host protocol, process supervision, and Sessions UX on
which every real runtime adapter depends.

## Locked decisions (2026-08-11)

| # | Topic | Choice |
| - | ----- | ------ |
| 1 | Product surface | Workspace Sessions is the only AI surface; remove Chat and the planned Cloud context |
| 2 | Persistence | Start with the new runtime-neutral schema; no migration or compatibility codecs |
| 3 | SDK boundary | Vendor SDKs and processes stay outside the WebView in one bundled Agent Host |
| 4 | Host transport | Versioned JSON-RPC over stdio, supervised by Tauri |
| 5 | Runtime binding | Runtime is immutable after session creation |

## Goal

A deterministic fake runtime can exercise the complete Sessions lifecycle
without any provider-specific type or process leaking into common frontend code.

## Scope

| ID | Item | Current state |
| --- | ---- | ------------- |
| AS01-A | Remove Chat and dormant Cloud product/state | Legacy code present |
| AS01-B | Runtime-neutral domain and persistence | Provider-shaped |
| AS01-C | Adapter core, extensions, capabilities, fake runtime | Missing |
| AS01-D | Bundled Agent Host and versioned protocol | Missing |
| AS01-E | Tauri host/process supervision | Provider-specific |
| AS01-F | Unified Sessions UX and foundation exit | Partial legacy UI |

## Outcome

- Chat/Cloud are absent from product UI, state, persistence, settings, and docs.
- A fake adapter creates, streams, cancels, persists, restores, and renders a
  session end to end.
- The common codebase and WebView contain no vendor SDK types.
- Agent Host and its descendants terminate cleanly on exit and recovery paths.

## Dependencies

- None. This is the root implementation milestone.

**Blocks:** every runtime adapter in phases 02–05 and release work in phase 06.

## Out of scope

- Real vendor adapters — phases 02–05.
- Legacy AI-state migration or compatibility shims.
- Worktrees, writer locks, automatic git operations, or rollback.

## Risks

- **Over-generalizing before real adapters** — keep the mandatory core minimal
  and use capabilities/extensions for optional behavior.
- **Orphan processes** — require process-tree cleanup tests before phase exit.
- **Accidental reusable UI deletion** — characterize transcript/tool rendering
  before removing Chat-specific state and routing.

## Definition of done

- Every phase plan A–F is marked Done and its acceptance checks pass.
- Foundation exit criteria in [`execution-plan.md`](execution-plan.md) pass.
- Changelog records the breaking Chat/state reset and the shipped foundation.
- Status is changed to Done in this README and [`../roadmap.md`](../roadmap.md).

### Definition of done — docs

- [ ] Active architecture and user docs describe workspace Sessions only.
- [ ] Removed Chat/Cloud docs are archived or deleted as appropriate.
- [ ] Changelog entry appended in [`../../changelog.md`](../../changelog.md).
- [ ] Exit criteria manually reviewed before phase 02 starts.
