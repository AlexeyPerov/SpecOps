# 05 — Cursor adapter

**Status:** Planned  
**Date:** 2026-08-11  
**Main doc (SSOT):** [`../roadmap.md`](../roadmap.md)  
**Execution plan:** [`execution-plan.md`](execution-plan.md)  
**Phase plans:** [A](execution-plan-phase-a-sdk-auth.md), [B](execution-plan-phase-b-agent-events.md), [C](execution-plan-phase-c-capabilities-cloud.md), [D](execution-plan-phase-d-hardening-exit.md)

This milestone adds the fourth runtime through its official local SDK mode,
after the common contract has already survived three adapters.

## Locked decisions (2026-08-11)

| # | Topic | Choice |
| - | ----- | ------ |
| 1 | SDK | Pin a tested public-beta TypeScript SDK in Agent Host |
| 2 | Authentication | Supported user or service-account API keys |
| 3 | Execution | Local agent uses the real workspace `rootPath` as `cwd` |
| 4 | Unsupported behavior | Capability-gate it; do not emulate with prompts |
| 5 | Cloud | Deferred runtime extension, never a separate product context |

## Goal

Cursor local runs can create, stream, follow up, cancel, report usage, and
restore as far as the pinned SDK supports, alongside the other runtimes.

## Scope

| ID | Item | Current state |
| --- | ---- | ------------- |
| AS05-A | SDK bootstrap, auth, health, model/mode catalogs | Missing |
| AS05-B | Durable agents/runs, streaming, follow-up and recovery | Missing |
| AS05-C | Capability gaps and cloud deferral contract | Missing |
| AS05-D | Contract tests, real-key smoke, packaging exit | Missing |

## Outcome

- All four runtimes own independent sessions in one workspace.
- Runtime-specific beta/health state never degrades healthy adapters.
- No standalone Chat or Cloud lane returns.

## Dependencies

- **Phases 01–04** — Done, including broad common-contract evidence.

**Blocks:** final handoff and release phase 06.

## Out of scope

- Prompt-based emulation of read-only, permission, fork, or lifecycle features.
- Generic HTTP-provider credentials.
- Cloud execution implementation in this milestone.

## Risks

- **Public-beta SDK drift** — pin the version and expose independent runtime
  health/version state.
- **Capability ambiguity** — verify each descriptor against observed SDK
  behavior and default unsupported features to absent.

## Definition of done

- All phase plans A–D and the shared adapter contract pass.
- Manually gated real-key smoke and packaging checks pass.
- Status is changed to Done here and in [`../roadmap.md`](../roadmap.md).

### Definition of done — docs

- [ ] Authentication, supported capabilities, beta limits, and recovery documented.
- [ ] Changelog entry appended in [`../../changelog.md`](../../changelog.md).
- [ ] Exit criteria manually reviewed before phase 06 starts.
