# 06 — Phase D: repeatable subset release gate and final closure

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** Early AS06-B/C plus acceptance of each adapter baseline/profile feature selected for this release. AS06-A only if handoff is advertised. First invocation follows AS03-D; later invocations add scope.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Decide release readiness for a concrete enabled runtime/platform subset; close the whole roadmap only when its full active scope is complete.

## Implementation boundary

Own versioned release/support records, regression/security docs and release recommendation. A successful Codex release does not mark unimplemented future adapters or this repeatable gate fully complete.

## Tasks

### AS06-D-01 — Record selected support scope and lifecycle matrix

Identify enabled runtimes/profile features/platforms, exact versions, distribution mode and advertised capabilities. Verify install/resolve/auth/create/send/tools/interactions/cancel/restart/resume/logout/quit and child/grandchild cleanup for each supported combination.

**Acceptance:** First record may contain macOS/Codex only. Every advertised combination has pass/fail evidence and no unresolved blocker; excluded features are clearly unadvertised, not claimed Done.

### AS06-D-02 — Verify shared and cross-runtime workflows

Run sibling Codex threads on first release; add profile/vendor coexistence as shipped. Test independent offline/limits, writer warnings, external edits, workspace switching and every advertised ordered handoff pair.

**Acceptance:** Editor/session data remains usable when a profile/runtime fails; whole-host death settles streams. No handoff pair is promised without evidence; no all-four-adapter gate blocks initial release.

### AS06-D-03 — Run security and bounded-protocol gate

Use auth/error/transcript/handoff/export canaries, malformed/oversized native payloads, inherited auth environment, path scope and approvals. Confirm no unbounded queue/wait or implicit native permission allow.

**Acceptance:** Selected installed build meets secret/profile boundaries and bounded lifecycle guarantees; unsupported platforms/capabilities cannot masquerade as accepted.

### AS06-D-04 — Publish docs and subset release decision

Finalize setup/profile/config/native capability ledger, limits, shared-cwd risks, native history/cache/reset, Stop, handoff where enabled, diagnostics and recovery. Record checks and actual smoke, update changelog and corresponding baseline statuses.

**Acceptance:** Release recommendation names supported subset and evidence. Planned later phases stay open; no persisted-data migration or upgrade path is added for this documentation task.

### AS06-D-05 — Close complete roadmap separately

After all active tasks including later extensions/profiles and supported adapter gates pass, rerun full selected matrix and mark roadmap complete. If scope changes, explicitly revise roadmap instead of treating a deferment as implementation. Preserve/archive evidence without dangling links.

**Acceptance:** Roadmap Done means its current full active scope is verified. An earlier subset release record does not close D or mark future adapters Done.

## Verification

- Run appropriate full regression/type/build and installed lifecycle checks for the selected release.
- Review recorded runtime/platform/profile/advertised-feature scope and blocker dispositions.
- Manually inspect descendants after quit/crash on each supported target.

## Exit and next work

Repeat this gate for each expanded release. Final D/roadmap Done is a distinct terminal acceptance, never implied by the first Codex preview. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
