# 05 — Phase C: native capability ledger and cloud boundary

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS05-B accepted.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Offer only policy/lifecycle capabilities the pinned local runtime actually enforces.

## Implementation boundary

Own tested native policy/tool/config feature ledger and UI; no cloud execution implementation or invented missing-native action.

## Tasks

### AS05-C-01 — Verify native policy and lifecycle behavior

Observe read-only/ask/workspace-write, sandbox/native tools/hooks, approvals/user input, fork/checkpoint, usage/catalog and restart. Distinguish native SDK default tool execution from support for user approval UI.

**Acceptance:** Ledger marks supported/conditional/unsupported/unknown with evidence; native quickstart behavior cannot accidentally imply interactive approvals.

### AS05-C-02 — Implement supported settings/config extensions

Expose tested model/options/native sandbox/hooks/policy and optional config/tool extensions. Check workspace/profile rules, skills/MCP/subagent scope as supported and separate native execution/display/configuration.

**Acceptance:** No invalid/no-op option or prompt-based read-only claim; common capabilities represent actual write behavior and writer visibility accurately.

### AS05-C-03 — Gate unsupported interactions and lifecycle

Hide/explain missing native approvals/questions/fork/checkpoints/restore; only add a native hook bridge if verified enforcement/correlation semantics support it.

**Acceptance:** Unsupported actions produce no request; no silent auto-approval is sold as an approval interaction and no prompt substitutes for native enforcement.

### AS05-C-04 — Preserve cloud deferral boundary

If the SDK exposes cloud metadata, model it as runtime-specific descriptor data
without adding execution, routing, persistence, or a top-level Cloud context.

**Acceptance:** Active product navigation remains workspace Sessions only; future cloud work has a clear extension point.

## Verification

- Run adapter/profile/schema/mapper and capability fixtures appropriate to this phase, using no live credential by default.
- Check error/log/transcript/export boundaries with canaries and late profile/generation events.
- Record pinned native contracts and optional real-runtime/installed smoke for the advertised support scope.

## Exit and next work

D follows finite native feature/capability ledger with no advertised unknown behavior. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
