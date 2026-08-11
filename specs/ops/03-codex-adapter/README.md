# 03 — Codex adapter

**Status:** Planned  
**Date:** 2026-08-11  
**Main doc (SSOT):** [`../roadmap.md`](../roadmap.md)  
**Execution plan:** [`execution-plan.md`](execution-plan.md)  
**Phase plans:** [A](execution-plan-phase-a-protocol-auth.md), [B](execution-plan-phase-b-thread-events.md), [C](execution-plan-phase-c-capabilities-history.md), [D](execution-plan-phase-d-hardening-exit.md)

This milestone adds the second production runtime through its official
app-server protocol and tests that the common contract does not encode assumptions
from the first adapter.

## Locked decisions (2026-08-11)

| # | Topic | Choice |
| - | ----- | ------ |
| 1 | Integration | Launch and supervise a pinned app-server through Agent Host |
| 2 | Authentication | Support API-key and official ChatGPT browser/device login |
| 3 | Protocol drift | Fail closed with an unsupported-version error |
| 4 | History | Native thread history is authoritative; SpecOps transcript is a cache |

## Goal

Claude and Codex sessions coexist, authenticate independently, resume their own
native histories, and use one capability-driven Sessions UI.

## Scope

| ID | Item | Current state |
| --- | ---- | ------------- |
| AS03-A | App-server process, schema pinning, init and auth | Missing |
| AS03-B | Thread/turn lifecycle and streamed event normalization | Missing |
| AS03-C | Modes, approvals, account/rate limits and history reconciliation | Missing |
| AS03-D | Drift/recovery tests, credential smoke and milestone exit | Missing |

## Outcome

- Both official login paths work without frontend secret persistence.
- Threads, turns, tools, approvals, questions, cancellation, sandbox state, and
  rate limits are represented through common capabilities.
- Either runtime may be offline without disabling the other.

## Dependencies

- **Phase 01** foundation — Done.
- **Phase 02** first real adapter — Done and contract lessons incorporated.

**Blocks:** phase 04 adapter migration.

## Out of scope

- Reimplementing the app-server protocol in the frontend.
- Treating cached transcript data as native source of truth.
- Cross-runtime handoff — phase 06.

## Risks

- **Schema drift** — pin schemas and versions; reject mismatches before a turn.
- **Interactive auth interruption** — persist no secret and expose resumable,
  explicit login state.

## Definition of done

- All phase plans A–D and the shared adapter contract pass.
- API-key and ChatGPT-login smokes pass behind manual credential gates.
- Status is changed to Done here and in [`../roadmap.md`](../roadmap.md).

### Definition of done — docs

- [ ] Authentication, modes, account state, version support, and recovery documented.
- [ ] Changelog entry appended in [`../../changelog.md`](../../changelog.md).
- [ ] Exit criteria manually reviewed before phase 04 starts.
