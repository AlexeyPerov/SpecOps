# 02 — Claude adapter

**Status:** Planned  
**Date:** 2026-08-11  
**Main doc (SSOT):** [`../roadmap.md`](../roadmap.md)  
**Execution plan:** [`execution-plan.md`](execution-plan.md)  
**Phase plans:** [A](execution-plan-phase-a-sdk-auth.md), [B](execution-plan-phase-b-session-events.md), [C](execution-plan-phase-c-capabilities.md), [D](execution-plan-phase-d-hardening-exit.md)

This milestone proves the common contract with the first production runtime and
delivers resumable Claude sessions through the shared Sessions UI.

## Locked decisions (2026-08-11)

| # | Topic | Choice |
| - | ----- | ------ |
| 1 | SDK location | Official TypeScript agent SDK runs inside Agent Host |
| 2 | Authentication | API key and supported cloud-provider credentials; no consumer OAuth |
| 3 | Workspace | Use the real workspace `rootPath` as `cwd` |
| 4 | Optional behavior | Advertise only capabilities actually supported by the pinned SDK |

## Goal

Users can create, run, cancel, restart, and resume independent Claude sessions
without credentials or provider payloads entering frontend persistence.

## Scope

| ID | Item | Current state |
| --- | ---- | ------------- |
| AS02-A | SDK bootstrap, auth, descriptor, catalogs | Missing |
| AS02-B | Session lifecycle and normalized event stream | Missing |
| AS02-C | Permissions, questions, tools, limits, MCP and optional features | Missing |
| AS02-D | Recovery, security tests, real-key smoke, milestone exit | Missing |

## Outcome

- Two Claude sessions coexist and resume by distinct native ids after restart.
- Text, reasoning, tools, permissions/questions, usage, errors, and cancellation
  render through the common UI.
- A second write-capable session warns but is still allowed.

## Dependencies

- **Phase 01** foundation and Agent Host — Done.

**Blocks:** phase 03, which validates the contract with a second runtime.

## Out of scope

- Consumer-account OAuth.
- Emulation of unsupported lifecycle or permission behavior.
- Cross-runtime handoff — phase 06.

## Risks

- **Native history may be missing or interrupted** — expose a clear
  non-destructive state and retain SpecOps metadata.
- **Secret leakage through raw events** — use canary-based redaction tests at
  both adapter and diagnostic-export boundaries.

## Definition of done

- All phase plans A–D are Done and the shared adapter contract passes.
- Manually gated real-key smoke passes without persisting the key.
- Status is changed to Done here and in [`../roadmap.md`](../roadmap.md).

### Definition of done — docs

- [ ] Authentication, capabilities, recovery, and installation documented.
- [ ] Changelog entry appended in [`../../changelog.md`](../../changelog.md).
- [ ] Exit criteria manually reviewed before phase 03 starts.
