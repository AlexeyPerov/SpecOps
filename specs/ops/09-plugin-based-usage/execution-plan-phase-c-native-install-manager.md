# 09 — Phase C: Native bootstrap and durable installer

**Date:** 2026-10-10

**Status:** Planned; all tasks open

**Prerequisites:** AS09-A; AS09-B fixture artifacts and trust metadata.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Deliver native bootstrap and durable installer for optional first-party agent components, including shared Node installation on demand.

## Tasks

### AS09-C-01 — Implement Node-independent component management

**State:** [TODO]

Implement catalog verification, component inventory and download/install operations in Rust/Tauri. Ship a small host JS bundle in the base app, but do not start it until a compatible downloaded Node is ready. Management/discovery UI works without Agent Host or vendor SDK availability.

**Acceptance:** A clean installed app without system Node or agent components opens editor/settings and manages installation; no hidden Node/vendor process is spawned by basic app startup.

### AS09-C-02 — Implement explicit bounded download jobs

**State:** [TODO]

Start downloads only for the confirmed component/dependency plan. Expose bytes/progress/cancel/retry; bound response size, time, redirect count, endpoint policy and simultaneous jobs. Validate available disk for download/unpack/retained versions; bind jobs to component/version/target and deduplicate requests across windows.

**Acceptance:** Offline/TLS/proxy/authenticated-URL/redirect/low-disk failures produce safe actionable errors; duplicate clicks/windows create one owned job and do not launch agent work.

### AS09-C-03 — Verify and safely extract component packages

**State:** [TODO]

Verify signed metadata and archive hash before extraction; allowlist formats and enforce entry/file/count/size limits. Reject traversal, absolute paths, dangerous links/special files and archive expansion abuse. Apply reviewed executable permissions and target checks without privilege elevation or shell interpolation.

**Acceptance:** Tampered/truncated/wrong-target/oversized/traversal/symlink archives cannot create or execute files outside private staging. No artifact code or install script runs before validation.

### AS09-C-04 — Commit installation atomically and recover interrupted work

**State:** [TODO]

Install to a private staging directory, validate complete inventory and a bounded no-account version probe, then atomically activate an immutable version with a durable receipt. Recover download/verification/activation interruption after app or machine crash; active versions stay usable until successful activation.

**Acceptance:** Crash at each boundary yields either the old valid selection or the fully verified new selection. A partial install is never listed as ready; corrupt receipts fail closed and can be rebuilt safely.

### AS09-C-05 — Coordinate locks, ownership and application shutdown

**State:** [TODO]

Use bounded cross-window/process installation locks with stale-owner handling and generation-scoped events. Define cancellation/quit behavior during download, extraction and activation; serialize mutations per component. Resume partial downloads only when remote identity/range metadata and final hash permit it.

**Acceptance:** Concurrent installers/removal/update cannot race the active selection; quit does not leave unmanaged installer descendants, permanent locks or an executable partial version.

### AS09-C-06 — Expose finite component APIs and safe diagnostics

**State:** [TODO]

Provide typed list/plan/install/cancel/retry/update/select/remove/clean-cache commands and bounded status events independent of host. Use approved catalog IDs, never arbitrary URL/path commands. Exports include component/version/verification/job state and redact sensitive headers, auth URLs and private absolute paths.

**Acceptance:** Malformed/foreign/stale requests and secret canaries cannot cross the UI/export boundary; a failed job does not disrupt editor functions or unrelated installed components.

## Verification and evidence

Record exact app/host/component/catalog versions and target for the tasks above. Use bounded no-account fixtures for source/security checks; use clean signed installed builds and authorized accounts where acceptance calls for them. Record pass, failed, not-run and unavailable separately. No runtime/account/installed/distribution result is inferred from a successful source build.

## Exit

Update phase evidence, execution index, roadmap and `specs/changelog.md` when work lands. Mark a task `[DONE]` only after its implementation and stated acceptance pass. Do not add persisted-data migrations, compatibility shims or native-history upgrade/downgrade paths.
