# 01 — Phase S: foundation acceptance stabilization

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** Historical A–F implementation present; read review round 1 and the 2026-10-04 audit. No production adapter required.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Make persisted bindings, streams and supervision safe enough for real credentials and native processes. Close P0 first, then the critical P1 transport/recovery gates.

## Implementation boundary

Own common persistence, host transport/error boundaries, Tauri supervision and shared fixtures. Vendor login/profile UI belongs to 02-A; installed packaging belongs to 03-B.

## Tasks

### AS01-S-01 — Persist full bindings through the production writer

Fix index replacement, binding/mode/settings persistence and missing writer calls. Test actual save/load paths, not only a codec helper; preserve every neutral binding field and prepare for profile identity added by 02-A. [Evidence](../done/01-foundation-agent-host/review-issues-1.md): R1-C1, M28 and mode persistence findings.

**Acceptance:** Save a binding, terminate store/host state, reload disk into fresh instances, and resume the same native ID. No replacement thread is minted and incompatible refreshed IDs have an explicit policy.

### AS01-S-02 — Bound supervisor I/O and process lifecycle

Move pipe writes outside the lifecycle mutex into a bounded writer path with deadlines. Serialize/generation-check lifecycle operations. Fix cooperative shutdown, grace escalation, liveness-race process-group cleanup, stale-reader/request handling and platform cleanup. Evidence: R1-C2, M10–M14.

**Acceptance:** A peer that never reads stdin cannot hang status/quit. Crash/stop/restart reaps descendants and settles pending calls within recorded bounds on each supported target; stale generations cannot kill a replacement.

### AS01-S-03 — Settle streams and protect error output

Handle pump rejection and EPIPE without a second fatal write. Settle frontend iterators on host exit/listener failure/generation replacement/cancel; close subscriptions. Make terminal delivery loss detectable. Redact typed/protocol/adapter errors and synthetic events at the output boundary. Evidence: R1-C3, M5, M27.

**Acceptance:** All failure fixtures terminate once and release resources; cancellation remains bounded. Secret canaries never reach transcript/settings/logs/export. Recovery offers resume without replaying the previous prompt.

### AS01-S-04 — Fix framing, limits and contract evidence

Use stateful UTF-8 decoding, EOF/error propagation, bounded input/output queues, symmetric size limits and real backpressure. Resolve malformed request IDs and hung dispatch deadlines. Drain iterators past the first terminal under a timeout; fresh-process restart tests; union-variant codec and capability-extension checks. Evidence: R1-M2–M8, M17–M25.

**Acceptance:** Split Cyrillic/emoji round-trip; oversized/flooding peers remain bounded; every accepted request settles. Duplicate terminal and missing iterator completion fail the suite. Resume is proven with new adapter/process instances.

### AS01-S-05 — Triage remaining review and close stabilization

Create a finite disposition ledger for every remaining Critical/Major R1 item: fixed with evidence, assigned to a linked phase/task, or rejected with source evidence. Cover startup/catalog ensure/retry ownership in 02-A and reproducible build in 03-B. Record supported-platform limits.

**Acceptance:** No unowned credential, binding-loss, indefinite-wait or process-cleanup blocker remains before 02-A live login. Do not defer a critical flaw merely to keep S small; document noncritical residual work with its gate.

## Verification

- Run persistence integration, domain/codec, strengthened adapter contract, host framing/dispatch/error and Rust supervision fixtures.
- Exercise ignored stdin/shutdown, broken stdout, mid-turn host death and a new process generation.
- Record platform-specific orphan inspection and review disposition; update baseline statuses without rewriting historical evidence.

## Exit and next work

02-A starts after S acceptance. Packaging design may then begin in 03-B; no Claude prerequisite. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
